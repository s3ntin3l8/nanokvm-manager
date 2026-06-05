import CryptoJS from 'crypto-js';
import { describe, expect, it } from 'vitest';
import { encryptPassword, NANOKVM_PASSPHRASE } from './crypto';

describe('encryptPassword', () => {
  it('round-trips: decrypting the output with the NanoKVM passphrase yields the plaintext', () => {
    const plaintext = '***REDACTED-PASSWORD***';
    const encrypted = encryptPassword(plaintext);

    // The wire value is URI-encoded base64 of the CryptoJS "Salted__" envelope.
    const ciphertext = decodeURIComponent(encrypted);
    const decrypted = CryptoJS.AES.decrypt(ciphertext, NANOKVM_PASSPHRASE).toString(
      CryptoJS.enc.Utf8,
    );

    expect(decrypted).toBe(plaintext);
  });

  it('produces a fresh ciphertext on every call (random salt)', () => {
    expect(encryptPassword('same-input')).not.toBe(encryptPassword('same-input'));
  });

  it('returns a URI-safe string (no raw +, /, or = from base64)', () => {
    const out = encryptPassword('some/pass+word=');
    expect(out).not.toMatch(/[+/=]/);
  });
});
