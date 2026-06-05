# NanoKVM API — Phase 0 Spike Findings

Verified live on **2026-06-05** against `pve1-kvm.example.internal` → unit `198.51.100.20`
(firmware: application `2.3.6`, image `v1.4.0`, mDNS `kvm-redacted.local`). No secrets in this file.

## 1. Authentication

- `POST /api/auth/login` with JSON body `{ "username": "...", "password": "<encrypted>" }`.
- **The password is encrypted client-side before POST** (this is the critical, easily-missed step —
  the `login()` API helper looks plaintext, but the login *page component* transforms it first). From
  the deployed bundle `assets/encrypt-*.js`:
  ```js
  const qe = "nanokvm-sipeed-2024";                 // hardcoded firmware passphrase (NOT per-device)
  function We(R){ const $ = ze.AES.encrypt(R, qe).toString(); return encodeURIComponent($); }
  ```
  i.e. `password = encodeURIComponent( CryptoJS.AES.encrypt(plaintext, "nanokvm-sipeed-2024").toString() )`.
  - CryptoJS passphrase mode == OpenSSL `aes-256-cbc -md md5 -salt`: it derives key+IV from the
    passphrase + an 8-byte **random salt** (EVP_BytesToKey/MD5, 1 iter) and emits base64 of
    `"Salted__" + salt + ciphertext`. **Random salt ⇒ the ciphertext differs on every login.**
  - The passphrase is a static value baked into firmware, so this is obfuscation, not real secrecy —
    but the server decrypts with it, so we MUST replicate it exactly.
  - **Backend replication:** use the `crypto-js` npm package (same lib as the frontend):
    `encodeURIComponent(CryptoJS.AES.encrypt(plaintext, 'nanokvm-sipeed-2024').toString())`.
  - Verified live 2026-06-05: encrypting the real password this way → `POST /api/auth/login` returns
    `{ "code": 0, "data": { "token": "<jwt>" } }` on both `pve1-kvm` and `unraid-kvm`. (A raw plaintext
    password returns `-2 invalid username or password` — that earlier failure was the missing encryption,
    NOT a wrong credential.)
- On success the response is `{ code:0, data:{ token } }` AND the server sets cookie
  **`nano-kvm-token`** = that **JWT** (HS256). Decoded payload is
  `{ "username": "<user>", "exp": <unix> }`. Observed expiry ≈ 1 year out → effectively long-lived.
- All other `/api/*` calls authenticate via that cookie. The MJPEG `<img>` stream can also carry the
  token as a `?token=<jwt>` query param (used by the browser UI); server-to-server we use the cookie.
- **Failure shape:** `{ "code": -2, "msg": "invalid username or password", "data": null }` (HTTP 200).
- Stateless JWT ⇒ **multiple concurrent sessions coexist**. Our backend's polling session and a user
  opening the native UI do NOT evict each other. (Spike Q4 resolved — no single-session lock.)

## 2. Video / Snapshot

- **No dedicated snapshot/screenshot endpoint exists.**
- MJPEG stream: `GET /api/stream/mjpeg` → `200`, `content-type: multipart/x-mixed-replace; boundary=frame`.
  Continuous JPEG frames separated by the `--frame` boundary.
- **Snapshot strategy:** open `/api/stream/mjpeg`, read bytes until the first complete JPEG
  (`\xFF\xD8` … `\xFF\xD9`) / first boundary block, then close the connection. That single frame is the
  card preview, refreshed every few seconds.
- Frame-detection controls (stream pauses when the host screen is static): `POST /api/stream/mjpeg/detect`
  `{enabled}` and `POST /api/stream/mjpeg/detect/stop` `{duration}`.
- This firmware ALSO streams **H264** to a `<video>` element via MSE/WebSocket (no `src` attr). We do
  **not** use it — snapshots come from MJPEG; full motion is handled by the native UI on handoff.

## 3. Power / Status (ATX + LED)

- **Read power/LED state:** `GET /api/vm/gpio` → `{ "code":0, "data": { "pwr": true, "hdd": false } }`.
  `pwr` = power LED (host on/off signal), `hdd` = activity LED.
  (NOTE: earlier assumption `/api/vm/gpio/led` was wrong — it's `GET /api/vm/gpio`.)
- **ATX control:** `POST /api/vm/gpio` with `{ "type": "...", "duration": <ms> }`
  (`setGpio(type, duration)` in `web/src/api/vm.ts`). `type` ∈ power/reset; long-press = larger duration.
  Exact `type` string values still to confirm by reading the web UI's button handlers before wiring.

## 4. Device info / discovery

- `GET /api/vm/info` → `{ ips:[{name,addr,version,type}], mdns:"kvm-XXXX.local", image, application, deviceKey }`.
  - `deviceKey` is a stable unique id → good join key for inventory + mDNS-discovered units.
  - `mdns` confirms units advertise `kvm-XXXX.local` (relevant for the optional mDNS discovery feature).
- `GET /api/vm/hardware` → hardware platform version.
- `GET /api/vm/web-title`, `GET /api/application/version`, storage/HID routes also exist (not needed for v1).

## Implications for the build

- `nanokvm` client interface: `login()` (**AES-encrypt password per §1** → POST → capture
  `nano-kvm-token` JWT from response/cookie, cache, re-auth on 401/expiry) · `getGpio()` (power state) ·
  `setGpio(type,duration)` (ATX) · `snapshot()` (first MJPEG frame) · `getInfo()` (status/identity).
  Depends on the `crypto-js` package for the login encryption.
- Reverse-proxy hosts have valid TLS; direct-IP hosts would need cert handling — config carries the base URL.
- **Config/env naming:** standardize on `NANOKVM_USER` / `NANOKVM_PASSWORD`. Current `.env` uses
  `NANOKMV_USER` (typo) and `NANOKVM_PWD` — reconcile in the config loader or fix `.env`.

## Resolved

- The `.env` credentials (`kvmadmin` / the 19-char password) are **correct**. The earlier `-2` failures
  were entirely due to missing the client-side AES encryption described in §1 — once replicated, both
  units return `code:0`. No credential change needed; just standardize the env var names
  (`NANOKMV_USER` → `NANOKVM_USER`, `NANOKVM_PWD` → `NANOKVM_PASSWORD`).
