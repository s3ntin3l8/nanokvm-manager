import { describe, expect, it } from 'vitest';
import { parseConfig } from './index';

const baseEnv = { NANOKVM_USER: 'kvmadmin', NANOKVM_PASSWORD: 'secret' };

describe('parseConfig', () => {
  it('parses required NanoKVM credentials', () => {
    const cfg = parseConfig(baseEnv, null);
    expect(cfg.nanokvm).toEqual({ user: 'kvmadmin', password: 'secret' });
    expect(cfg.hosts).toEqual([]);
    expect(cfg.port).toBe(8080);
  });

  it('accepts the legacy/typo env var names (NANOKMV_USER / NANOKVM_PWD)', () => {
    const cfg = parseConfig({ NANOKMV_USER: 'kvmadmin', NANOKVM_PWD: 'secret' }, null);
    expect(cfg.nanokvm).toEqual({ user: 'kvmadmin', password: 'secret' });
  });

  it('throws when credentials are missing', () => {
    expect(() => parseConfig({}, null)).toThrow(/must be set/);
  });

  it('parses hosts from an object with a hosts array and strips trailing slashes', () => {
    const cfg = parseConfig(baseEnv, {
      hosts: [{ id: 'pve1', name: 'Proxmox', kvmUrl: 'https://pve1-kvm.example.com/' }],
    });
    expect(cfg.hosts[0]).toMatchObject({
      id: 'pve1',
      name: 'Proxmox',
      kvmUrl: 'https://pve1-kvm.example.com',
    });
  });

  it('defaults host name to id and accepts a bare array', () => {
    const cfg = parseConfig(baseEnv, [{ id: 'x', kvmUrl: 'http://x' }]);
    expect(cfg.hosts[0]?.name).toBe('x');
  });

  it('rejects malformed host entries', () => {
    expect(() => parseConfig(baseEnv, [{ name: 'no id' }])).toThrow(/requires string/);
  });

  it('enables HA and Loki only when their env vars are present', () => {
    expect(parseConfig(baseEnv, null).homeAssistant).toBeUndefined();
    const cfg = parseConfig(
      { ...baseEnv, HA_URL: 'http://ha:8123/', HA_TOKEN: 't', LOKI_URL: 'http://loki:3100' },
      null,
    );
    expect(cfg.homeAssistant).toEqual({ url: 'http://ha:8123', token: 't' });
    expect(cfg.loki).toEqual({ url: 'http://loki:3100' });
  });
});
