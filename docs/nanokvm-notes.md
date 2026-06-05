# NanoKVM API — Phase 0 Spike Findings

Verified live on **2026-06-05** against `pve1-kvm.example.internal` → unit `198.51.100.20`
(firmware: application `2.3.6`, image `v1.4.0`, mDNS `kvm-redacted.local`). No secrets in this file.

## 1. Authentication

- `POST /api/auth/login` with JSON body `{ "username": "...", "password": "..." }`.
- **Password is sent in plaintext** — no RSA/AES/hash on the client (`web/src/api/auth.ts` posts the
  raw values; confirmed against the live unit).
- On success the server sets cookie **`nano-kvm-token`** = a **JWT** (HS256). Decoded payload is
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

- `nanokvm` client interface: `login()` (plaintext → capture `nano-kvm-token` cookie, cache, re-auth on
  401/expiry) · `getGpio()` (power state) · `setGpio(type,duration)` (ATX) · `snapshot()` (first MJPEG
  frame) · `getInfo()` (status/identity).
- Reverse-proxy hosts have valid TLS; direct-IP hosts would need cert handling — config carries the base URL.
- **Config/env naming:** standardize on `NANOKVM_USER` / `NANOKVM_PASSWORD`. Current `.env` uses
  `NANOKMV_USER` (typo) and `NANOKVM_PWD` — reconcile in the config loader or fix `.env`.

## Open item (blocker)

- The password currently in `.env` is **rejected** by the unit (`-2 invalid username or password`),
  verified via curl and an in-page fetch. Username `kvmadmin` is correct (present in the live JWT).
  Need the correct password before the `nanokvm` client can authenticate from scratch.
