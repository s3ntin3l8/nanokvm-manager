import CryptoJS from 'crypto-js';

/**
 * Passphrase hardcoded in the NanoKVM firmware's web bundle (assets/encrypt-*.js).
 * It is shared/static across devices — obfuscation, not a real secret — but the
 * device decrypts the login password with it, so we must use the same value.
 */
export const NANOKVM_PASSPHRASE = 'nanokvm-sipeed-2024';

/**
 * Replicate the NanoKVM web UI's client-side password encryption exactly:
 *
 *   encodeURIComponent(CryptoJS.AES.encrypt(plaintext, passphrase).toString())
 *
 * CryptoJS passphrase mode == OpenSSL `aes-256-cbc -md md5 -salt`: a random 8-byte
 * salt is generated per call, so the output differs every time. The login endpoint
 * (`POST /api/auth/login`) expects this transformed value, NOT the raw password.
 */
export function encryptPassword(
  plaintext: string,
  passphrase: string = NANOKVM_PASSPHRASE,
): string {
  const ciphertext = CryptoJS.AES.encrypt(plaintext, passphrase).toString();
  return encodeURIComponent(ciphertext);
}
