# nanokvm-dashboard

A self-hosted **single-pane-of-glass control plane** that aggregates several Sipeed NanoKVM units
into one portal — host grid with live preview, power state, ATX power actions, power-consumption
(Home Assistant), and per-host logs (Grafana Loki).

> ⚠️ **Safety:** this app can trigger physical **power / reset** of real PCs via NanoKVM ATX. ATX
> actions must always be behind an explicit confirm in the UI, and the app must run behind the
> reverse proxy + SSO — never exposed unauthenticated.

## Core design decision

We do **not** rebuild the interactive KVM session (live HID keyboard/mouse + video). That is the
hardest, most fragile part and duplicates Sipeed's already-good native UI. This app delivers the
**overview**; clicking a host **hands off to the native NanoKVM UI** for actual control.

## Stack

- **Backend:** Fastify + TypeScript. Thin proxy/aggregator.
- **Frontend:** React + Vite + TypeScript + Tailwind + shadcn/ui. Card grid.
- **Telemetry transport:** SSE (one stream per browser), tagged by host id.
- **Auth:** none in-app — runs behind the existing reverse proxy + Authentik/SSO.
- **Deploy:** single Docker image (multi-stage) serving API + built static frontend.

## Architecture / modules (backend, each isolated + independently testable)

- `inventory` — static config (primary, source of truth for creds/enrichment) + optional mDNS discovery.
- `nanokvm` — the ONLY module that knows NanoKVM specifics: `login()` (cookie cache, re-auth on 401),
  `getGpio()` (power state), `setGpio(type,duration)` (ATX), `snapshot()` (first MJPEG frame), `getInfo()`.
- `homeassistant` — single WS connection (long-lived token), subscribe wattage sensors, emit state.
- `loki` — `historyHost(selector,range)` + `tailHost(selector)`.
- `events` — SSE broker fanning HA state + Loki lines to browsers.
- HTTP routes: `GET /api/hosts` · `POST /api/hosts/:id/power` · `GET /api/hosts/:id/snapshot`
  · `GET /api/hosts/:id/logs?range=` · `GET /api/events` (SSE).

Frontend: `HostGrid` → per-host `HostCard` (isolated state so one host's refresh doesn't re-render others).

## NanoKVM API (verified — see `docs/nanokvm-notes.md` for full detail)

- Login: `POST /api/auth/login {username, password}` where `password` is **AES-encrypted client-side**:
  `encodeURIComponent(CryptoJS.AES.encrypt(plaintext, "nanokvm-sipeed-2024").toString())` (CryptoJS
  passphrase mode; hardcoded firmware passphrase). Returns `{code:0,data:{token}}` + cookie
  `nano-kvm-token`. Backend uses the `crypto-js` package to replicate. See `docs/nanokvm-notes.md` §1.
- Power state: `GET /api/vm/gpio` → `{pwr,hdd}`. ATX: `POST /api/vm/gpio {type,duration}`.
- Snapshot: first JPEG frame from `GET /api/stream/mjpeg` (multipart/x-mixed-replace) — no dedicated endpoint.
- Identity/status: `GET /api/vm/info` (ips, mdns name, firmware, stable `deviceKey`).

## Conventions / gotchas

- Secrets (NanoKVM creds, HA token, Loki URL) live in env/config, never in the frontend; backend holds
  all tokens, the browser only talks to our API. `.env` is gitignored.
- Env var naming target: `NANOKVM_USER` / `NANOKVM_PASSWORD` (current `.env` has a `NANOKMV_USER` typo).
- **mDNS does not cross a Docker bridge network** — discovery is opt-in and needs `network_mode: host`.
  Static config must always work without it.

## Dev / build / test commands

_TBD once scaffolded (pnpm workspace: `server/`, `web/`)._ Update this section as the toolchain lands.

## Plan

Living plan: `.claude/plans/ok-i-want-to-swift-quill.md`.
