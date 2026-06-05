import CryptoJS from 'crypto-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NanoKvmClient, NanoKvmError } from './client';
import { NANOKVM_PASSPHRASE } from './crypto';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK_LOGIN = { code: 0, msg: 'success', data: { token: 'jwt-token' } };

describe('NanoKvmClient', () => {
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = vi.fn();
  });

  function client() {
    return new NanoKvmClient({
      baseUrl: 'https://kvm.test/',
      username: 'kvmadmin',
      password: '***REDACTED-PASSWORD***',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
  }

  it('encrypts the password on login and caches the token as a cookie', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse(OK_LOGIN))
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, msg: 'success', data: { pwr: true, hdd: false } }),
      );

    const gpio = await client().getGpio();
    expect(gpio).toEqual({ pwr: true, hdd: false });

    // First call = login; body password must decrypt back to the plaintext.
    const [loginUrl, loginInit] = fetchFn.mock.calls[0];
    expect(loginUrl).toBe('https://kvm.test/api/auth/login');
    const sentPassword = JSON.parse(loginInit.body).password;
    const decrypted = CryptoJS.AES.decrypt(
      decodeURIComponent(sentPassword),
      NANOKVM_PASSPHRASE,
    ).toString(CryptoJS.enc.Utf8);
    expect(decrypted).toBe('***REDACTED-PASSWORD***');

    // Second call = authed request carrying the token cookie.
    const [, gpioInit] = fetchFn.mock.calls[1];
    expect(gpioInit.headers.cookie).toBe('nano-kvm-token=jwt-token');
  });

  it('re-authenticates once on a 401 then retries the request', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse(OK_LOGIN)) // initial login
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // expired
      .mockResolvedValueOnce(jsonResponse({ ...OK_LOGIN, data: { token: 'jwt-2' } })) // re-login
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, msg: 'success', data: { pwr: false, hdd: false } }),
      );

    const gpio = await client().getGpio();
    expect(gpio).toEqual({ pwr: false, hdd: false });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    // Final request uses the refreshed token.
    expect(fetchFn.mock.calls[3]?.[1].headers.cookie).toBe('nano-kvm-token=jwt-2');
  });

  it('maps power actions to gpio type+duration', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse(OK_LOGIN))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: 'ok', data: null }));
    await client().power('longpress');
    const [, init] = fetchFn.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ type: 'power', duration: 8000 });
  });

  it('throws on a non-zero response code', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse(OK_LOGIN))
      .mockResolvedValueOnce(jsonResponse({ code: -1, msg: 'nope', data: null }));
    await expect(client().getInfo()).rejects.toBeInstanceOf(NanoKvmError);
  });

  it('throws when login is rejected', async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ code: -2, msg: 'invalid username or password', data: null }),
    );
    await expect(client().getGpio()).rejects.toThrow(/invalid username/);
  });

  it('extracts the first JPEG frame from the MJPEG stream', async () => {
    const frame = Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
    const noise = Buffer.from([0x2d, 0x2d, 0x66]); // "--f" boundary noise before SOI
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(noise));
        controller.enqueue(new Uint8Array(frame));
        controller.enqueue(new Uint8Array([0xaa, 0xbb])); // trailing junk, should be ignored
        controller.close();
      },
    });
    fetchFn
      .mockResolvedValueOnce(jsonResponse(OK_LOGIN))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const snap = await client().snapshot();
    expect(Buffer.from(snap)).toEqual(frame);
  });
});
