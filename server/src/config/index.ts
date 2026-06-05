import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface HostConfig {
  id: string;
  name: string;
  /** Base URL of the NanoKVM unit, e.g. https://pve1-kvm.example.com */
  kvmUrl: string;
  /** Per-host credential overrides; fall back to the global NANOKVM_USER/PASSWORD. */
  user?: string;
  password?: string;
  /** Home Assistant sensor entity id for this host's power draw, e.g. sensor.pve1_power. */
  haEntity?: string;
  /** Loki LogQL stream selector for this host, e.g. {host="pve1"}. */
  lokiSelector?: string;
}

export interface AppConfig {
  port: number;
  /** Directory of the built static frontend to serve (production). */
  webDir: string;
  /** Global NanoKVM credentials (per-host overrides win). */
  nanokvm: { user: string; password: string };
  hosts: HostConfig[];
  homeAssistant?: { url: string; token: string };
  loki?: { url: string };
  mdns: { enabled: boolean };
}

type Env = Record<string, string | undefined>;

function pick(env: Env, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

function parseHosts(raw: unknown): HostConfig[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : (raw as { hosts?: unknown }).hosts;
  if (!Array.isArray(list)) {
    throw new Error('hosts config must be an array, or an object with a "hosts" array');
  }
  return list.map((entry, i) => {
    const h = entry as Record<string, unknown>;
    if (typeof h.id !== 'string' || typeof h.kvmUrl !== 'string') {
      throw new Error(`hosts[${i}] requires string "id" and "kvmUrl"`);
    }
    return {
      id: h.id,
      name: typeof h.name === 'string' ? h.name : h.id,
      kvmUrl: h.kvmUrl.replace(/\/+$/, ''),
      user: typeof h.user === 'string' ? h.user : undefined,
      password: typeof h.password === 'string' ? h.password : undefined,
      haEntity: typeof h.haEntity === 'string' ? h.haEntity : undefined,
      lokiSelector: typeof h.lokiSelector === 'string' ? h.lokiSelector : undefined,
    };
  });
}

/**
 * Pure config builder — no filesystem/process access, so it is easy to unit test.
 * Accepts the env map and the already-parsed hosts config.
 *
 * Env var names are tolerant: the canonical names are NANOKVM_USER /
 * NANOKVM_PASSWORD, but the legacy/typo'd NANOKMV_USER / NANOKVM_PWD are also
 * accepted (the project's original .env used those).
 */
export function parseConfig(env: Env, hostsRaw: unknown): AppConfig {
  const user = pick(env, 'NANOKVM_USER', 'NANOKMV_USER');
  const password = pick(env, 'NANOKVM_PASSWORD', 'NANOKVM_PWD');
  if (!user || !password) {
    throw new Error(
      'NANOKVM_USER and NANOKVM_PASSWORD (or legacy NANOKMV_USER / NANOKVM_PWD) must be set',
    );
  }

  const haUrl = pick(env, 'HA_URL');
  const haToken = pick(env, 'HA_TOKEN');
  const lokiUrl = pick(env, 'LOKI_URL');

  return {
    port: Number(pick(env, 'PORT') ?? 8080),
    webDir: pick(env, 'WEB_DIR') ?? resolve(process.cwd(), 'web', 'dist'),
    nanokvm: { user, password },
    hosts: parseHosts(hostsRaw),
    homeAssistant:
      haUrl && haToken ? { url: haUrl.replace(/\/+$/, ''), token: haToken } : undefined,
    loki: lokiUrl ? { url: lokiUrl.replace(/\/+$/, '') } : undefined,
    mdns: { enabled: pick(env, 'MDNS_ENABLED') === 'true' },
  };
}

/** Load config from process.env and the hosts file (JSON). Missing file → no hosts. */
export function loadConfig(): AppConfig {
  const hostsFile =
    pick(process.env, 'HOSTS_FILE') ?? resolve(process.cwd(), 'config', 'hosts.json');
  let hostsRaw: unknown = null;
  try {
    hostsRaw = JSON.parse(readFileSync(hostsFile, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No hosts file → rely on mDNS discovery / empty inventory.
  }
  return parseConfig(process.env, hostsRaw);
}
