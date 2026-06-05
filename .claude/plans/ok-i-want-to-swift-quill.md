# NanoKVM Aggregator Dashboard — Design & Implementation Plan

## Context

The user runs several Sipeed NanoKVM units to monitor/control multiple PCs. Today that
means juggling separate browser tabs/bookmarks per device. The goal is a **single-pane-of-glass
control plane**: one portal showing every host at a glance, enriched with power-consumption data
(Shelly via Home Assistant) and per-host logs (Grafana Loki).

**Key design decision (differs from the original Gemini brainstorm):** we do **not** rebuild the
interactive KVM session (live HID keyboard/mouse capture + video) — that is the hardest, most
fragile part and duplicates Sipeed's already-good native UI. Instead the app delivers the
**overview** (status, preview, power, logs) and **hands off to the native NanoKVM UI** for actual
interactive control. This removes ~60% of the risk while delivering the "one portal" value.

**Intended outcome:** a small, maintainable self-hosted dashboard with a host-card grid; each card
shows a live preview snapshot, online/power state, a wattage badge, ATX power buttons (with
confirm), and an expandable Loki log drawer — and opens the native NanoKVM UI on click.

## Decisions (locked with the user)

| Topic | Decision |
|---|---|
| Interactive control | Hand off to native NanoKVM UI (new tab); no in-app HID/video rebuild |
| v1 scope | Full vision: KVM grid + ATX power + HA wattage + Loki log drawer |
| Stack | Single-language TypeScript: **Fastify** backend + **React + Vite + Tailwind + shadcn/ui** frontend |
| App auth | None built in — runs **behind the user's existing reverse proxy + Authentik/SSO** |
| Inventory | **Static config file is the primary, always-works path**; mDNS auto-discovery is an *optional* enhancement (see deployment caveat) |
| Preview | **Periodic snapshot** (single frame every few seconds), not live MJPEG in cards |
| Telemetry transport | **SSE** (one stream per browser), backend fans out HA state + Loki lines tagged by host id |

## Phase 0 — Spike FIRST (gate everything on this)

**Live spike targets (provided by user):**
- NanoKVM units: two units on the LAN (IPs redacted)
- Via Traefik reverse proxy: two HTTPS reverse-proxy hostnames (redacted)
- Credentials in `.env`: `NANOKVM_USER` and the password var (user wrote `NANKVM_PWD` — verify exact
  name when reading `.env`, there may be a typo to reconcile).
- Ground-truth method: drive the native UI login in the connected browser and read the Network tab
  for the real login request/response, then replicate.


Two NanoKVM facts are **not publicly documented** and several assumptions must be verified against
a **real unit** before building. Do this against a live device using the connected browser's
DevTools Network tab (ground truth — firmware versions vary), supplemented by reading source in
`sipeed/NanoKVM` `server/router/{auth,vm,stream}.go` and the `web/` login code.

Resolve and record:
1. **Login/auth flow** — exact `POST /api/auth/login` request: how the password is encrypted/encoded
   client-side (RSA public key fetched first? AES? hash?), and the token/cookie returned (JWT).
   Replicate precisely in the `nanokvm` module.
2. **Preview source** — is there a native single-frame **snapshot** endpoint, or must we open the
   MJPEG multipart stream, read one frame, and disconnect? The `snapshot()` method and
   `GET /api/hosts/:id/snapshot` route depend on the answer.
3. **MJPEG stream path** — exact path (for the snapshot fallback and any future embedded preview).
4. **Concurrent-session limit** — does a unit allow only one authenticated session at a time? If so,
   the backend's polling session and the native-UI session will collide. Determine the limit and the
   mitigation (e.g. share/reuse a session, or pause backend polling while native UI is open).

Confirmed from research (still verify against the unit):
- Go/Gin backend; routes under `server/router/`.
- `GET /api/vm/gpio/led` → `{pwr, hdd}` (host power LED state).
- `POST /api/vm/gpio` `{type:"power"|"reset", duration:<ms>}` (ATX; long-press = larger duration).
- `GET /api/vm/info`, `GET /api/vm/hardware` (device/status info).

## Architecture

```
Fastify backend (TypeScript)
  inventory  ──► static config (primary) + optional mDNS discovery
  nanokvm    ──► per-host client: login+cookie cache, getLedState, power(), snapshot()
  homeassistant ──► single WS conn, long-lived token, subscribe wattage sensors
  loki       ──► tailHost() live + historyHost(range)
  events     ──► SSE broker, fans HA state + Loki lines to browsers, tagged by host id
  routes: GET /api/hosts · POST /api/hosts/:id/power · GET /api/hosts/:id/snapshot
          GET /api/hosts/:id/logs?range= · GET /api/events (SSE)

React + Vite + Tailwind + shadcn/ui
  HostGrid → HostCard (per-host isolated state): snapshot img · power/online badge ·
             wattage badge · ATX buttons (confirm dialog) · expandable Loki drawer
             card click → open native NanoKVM UI in new tab
```

### Backend modules (each isolated, independently testable)

- **`inventory`** — loads config mapping each host → `{ id, name, kvmUrl, kvmUser, kvmPass, haEntity, lokiSelector }`.
  Merges optional mDNS-discovered units; units found but not in config surface as
  "discovered, unconfigured" (name/IP only, no HA/Loki/creds). Config is the source of truth for
  credentials and enrichment.
- **`nanokvm`** — the *only* module that knows NanoKVM specifics. Per-host: `login()` + cookie cache
  with re-auth on 401; `getLedState()`; `power(type, duration)`; `snapshot()` (implementation per
  Phase 0 result). Encapsulates firmware quirks behind a clean interface.
- **`homeassistant`** — single WebSocket connection (long-lived access token), subscribe to the
  configured wattage sensors, emit state-change events into the broker.
- **`loki`** — `historyHost(selector, range)` (REST `query_range`) and `tailHost(selector)` (live
  `/tail`), normalized into log-line events.
- **`events`** — SSE broker: tracks connected clients, fans HA state + Loki lines out, each message
  tagged with `hostId` and `type` ("power" | "log").
- **HTTP routes** (thin; delegate to modules) — listed in the diagram above.

### Frontend

- **`HostGrid`** renders one **`HostCard`** per host. Each card owns its own state so one host's
  snapshot refresh or log tail does not re-render the others (isolation = perf + clarity).
- **`HostCard`** sections: header (name + online/power badge + wattage), body (snapshot `<img>`,
  refreshed from `GET /api/hosts/:id/snapshot`), footer (ATX Power / Reset / Long-press buttons, each
  behind a shadcn confirm dialog to prevent accidental reboots), expandable drawer (Loki log lines
  streamed from the SSE channel, with a range selector hitting `/api/hosts/:id/logs`).
- Single SSE subscription (`/api/events`) in a small store (Zustand or context) demuxes events by
  `hostId` to the right card.
- Card click (outside buttons) → `window.open(kvmUrl)` to the native NanoKVM UI.

## Build sequence

Use git from the first step. Commit in suitable bundles (one coherent unit of work per commit —
roughly one per numbered step below, splitting further if a step is large). Each commit message
states what and why.

0. **Init repo** — `git init`; add `.gitignore` (node_modules, dist, build, `.env`, secrets/config
   with real credentials); write a starter **`CLAUDE.md`** (project purpose, architecture map, module
   responsibilities, dev/build/test commands, the native-handoff design decision, and the security
   note that the app can power/reset PCs). Initial commit.
1. **Phase 0 spike** (above) — record findings in the repo (e.g. `docs/nanokvm-notes.md`). Gate.
   Commit the findings. Keep `CLAUDE.md` updated as facts land.
2. **Scaffold** — pnpm workspace: `server/` (Fastify + TS) and `web/` (Vite + React + TS + Tailwind +
   shadcn). Config loader + types. Health route. Commit.
3. **`nanokvm` module** — login/cookie/ATX/led/snapshot against a real unit; unit-test the client with
   a mocked HTTP layer. Wire `GET /api/hosts`, `POST /api/hosts/:id/power`, `GET /api/hosts/:id/snapshot`.
4. **Frontend grid v1** — HostGrid/HostCard with snapshot + online/power badge + ATX buttons(+confirm)
   + native handoff. End-to-end usable here even before HA/Loki.
5. **`homeassistant` module + SSE** — WS subscribe wattage; broker; wattage badge in card.
6. **`loki` module** — history + tail; log drawer in card.
7. **mDNS discovery** (optional, last) — `bonjour-service`/`multicast-dns`; merge into inventory;
   "discovered, unconfigured" state.
8. **Dockerize** — multi-stage `Dockerfile` (deps → build → pruned runtime via `pnpm deploy --prod`),
   single image serving the API + built static frontend on port 8080. `.dockerignore` (excludes
   `.env`, `.git`, docs, node_modules). `compose.yaml` pulls the published GHCR image; `compose.override.yaml`
   adds `build:` so a local `docker compose up` builds from source (prod uses `docker compose -f compose.yaml up -d`).
   Release-gated publish: `.github/workflows/release.yml` builds + pushes to `ghcr.io/s3ntin3l8/nanokvm-manager`
   on `release: published` (and `workflow_dispatch`), tagged by semver + `latest`, using the built-in
   `GITHUB_TOKEN` (no registry secrets). The push/PR `ci.yml` stays lint/typecheck/test/build only — it does
   **not** build Docker. (Note: the Dockerfile/compose are committed as the deployment target now; they only
   build successfully once the `server`/`web` workspaces exist — verified at scaffolding.)

## Deployment notes / caveats

- **App auth:** none in-app; deploy behind the existing reverse proxy + Authentik. Document that the
  app trusts inbound identity and must not be exposed unauthenticated (it can power/reset PCs).
- **mDNS ⚠️ deployment conflict:** mDNS/multicast does **not** cross a Docker bridge network. If the
  container runs on an isolated bridge (the recommended secure setup), discovery finds nothing. mDNS
  therefore requires `network_mode: host` (or macvlan). **Static config must remain fully functional
  without mDNS;** treat discovery as an opt-in convenience and document the host-networking
  requirement. Do not let core inventory depend on it.
- **Secrets:** NanoKVM per-host credentials, HA long-lived token, and Loki URL come from config/env,
  never the frontend. Backend holds all tokens; browser only talks to our API.
- **Network path:** backend must reach the KVM VLAN, the Home Assistant instance, and Loki.
- **Deployment (Docker):** single multi-stage image. `compose.yaml` = production (pulls
  `ghcr.io/s3ntin3l8/nanokvm-manager:latest`, `env_file: .env`, mounts `./config` read-only for the host
  inventory). `compose.override.yaml` = local builds from source (auto-merged by `docker compose up`).
  Images published to **GHCR** only on GitHub **release** (semver + `latest` tags), built for `linux/amd64`
  (arm64 can be added later via buildx if a Pi-based host appears). Auth uses the built-in `GITHUB_TOKEN`.
- **Open-source readiness (repo will be public):** NO secrets anywhere in the repo. `.env` is gitignored;
  a sanitized **`.env.example`** is committed as the template. `.dockerignore` keeps `.env` out of the build
  context/image. Internal hostnames/IPs currently in `docs/` are acceptable while the repo is private —
  revisit/scrub before flipping the repo public.

## Verification (end-to-end)

- **Spike:** findings file exists and answers all four Phase 0 questions, validated against a real unit.
- **`nanokvm` client:** unit tests pass with mocked HTTP; manual run authenticates to a real unit,
  reads LED state, returns a snapshot, and a *test* ATX call (on a safe/throwaway host) toggles power.
- **Grid:** `GET /api/hosts` returns the configured inventory; each card shows a refreshing snapshot
  and correct online/power badge; clicking a card opens the native UI; ATX buttons trigger only after
  confirm and produce the expected physical action.
- **HA:** wattage badge updates live when the real sensor changes (verify by toggling load); correlate
  black screen + low watts (off) vs. blank screen + high watts (frozen).
- **Loki:** drawer shows recent lines for the host's selector and tails new lines live.
- **mDNS (if built):** with host networking, a powered NanoKVM not in config appears as
  "discovered, unconfigured"; with bridge networking, absence is expected and static hosts still work.
- **Container:** `docker run` of the final image serves the dashboard and reaches all three backends.

## Out of scope for v1 (future)

- In-app interactive KVM (HID capture / embedded live video) — intentionally deferred to native UI.
- Embedded iframe view of the native UI inside the dashboard.
- Multi-user auth/RBAC inside the app (handled by the reverse proxy/SSO).
- Virtual-media / image-mount management, scripting/macros.
