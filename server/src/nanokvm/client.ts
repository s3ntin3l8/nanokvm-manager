import { encryptPassword } from './crypto';
import type { GpioState, NanoKvmResponse, PowerAction, VmInfo } from './types';

export type FetchFn = typeof fetch;

export class NanoKvmError extends Error {}

export interface NanoKvmClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchFn;
  requestTimeoutMs?: number;
}

/** ATX action → NanoKVM gpio { type, duration(ms) }. Long-press = a long power hold. */
const POWER_ACTIONS: Record<PowerAction, { type: string; duration: number }> = {
  power: { type: 'power', duration: 800 },
  reset: { type: 'reset', duration: 800 },
  longpress: { type: 'power', duration: 8000 },
};

const COOKIE_NAME = 'nano-kvm-token';

/**
 * Client for a single NanoKVM unit. Encapsulates the firmware's quirks:
 * client-side password encryption, the `nano-kvm-token` cookie, and reading a
 * snapshot from the MJPEG stream. Caches the token and re-authenticates on 401.
 */
export class NanoKvmClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  private token: string | null = null;
  private loginInFlight: Promise<void> | null = null;

  constructor(opts: NanoKvmClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.username = opts.username;
    this.password = opts.password;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000;
  }

  /** POST /api/auth/login with the AES-encrypted password; caches the JWT. */
  async login(): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: encryptPassword(this.password) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new NanoKvmError(`login failed: HTTP ${res.status}`);
    const json = (await res.json()) as NanoKvmResponse<{ token?: string }>;
    if (json.code !== 0 || !json.data?.token) {
      throw new NanoKvmError(`login rejected: ${json.msg ?? `code ${json.code}`}`);
    }
    this.token = json.data.token;
  }

  private async ensureAuth(): Promise<void> {
    if (this.token) return;
    // Dedupe concurrent logins.
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    await this.loginInFlight;
  }

  private async authedFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
    await this.ensureAuth();
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, cookie: `${COOKIE_NAME}=${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 401 && retry) {
      this.token = null;
      return this.authedFetch(path, init, false);
    }
    return res;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.authedFetch(path, init);
    if (!res.ok) throw new NanoKvmError(`${init.method ?? 'GET'} ${path}: HTTP ${res.status}`);
    const json = (await res.json()) as NanoKvmResponse<T>;
    if (json.code !== 0) throw new NanoKvmError(`${path}: ${json.msg ?? `code ${json.code}`}`);
    return json.data;
  }

  /** Read the host power/HDD LED state. */
  getGpio(): Promise<GpioState> {
    return this.requestJson<GpioState>('/api/vm/gpio');
  }

  /** Trigger an ATX action (power / reset / long-press). */
  async power(action: PowerAction): Promise<void> {
    const payload = POWER_ACTIONS[action];
    await this.requestJson('/api/vm/gpio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /** Device identity + network info. */
  getInfo(): Promise<VmInfo> {
    return this.requestJson<VmInfo>('/api/vm/info');
  }

  /**
   * Grab a single JPEG still by reading the first complete frame from the MJPEG
   * stream (multipart/x-mixed-replace), then aborting. There is no dedicated
   * snapshot endpoint on the firmware.
   */
  async snapshot(): Promise<Buffer> {
    const res = await this.authedFetch('/api/stream/mjpeg', {});
    if (!res.ok || !res.body) throw new NanoKvmError(`snapshot: HTTP ${res.status}`);
    const reader = res.body.getReader();
    let buf = Buffer.alloc(0);
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = Buffer.concat([buf, Buffer.from(value)]);
        const start = buf.indexOf(SOI);
        if (start >= 0) {
          const end = buf.indexOf(EOI, start + 2);
          if (end >= 0) return buf.subarray(start, end + 2);
        }
        if (buf.length > 8_000_000) throw new NanoKvmError('snapshot: frame too large');
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new NanoKvmError('snapshot: no complete JPEG frame received');
  }
}
