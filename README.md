# nanokvm-manager

A self-hosted **single-pane-of-glass control plane** for several [Sipeed NanoKVM](https://github.com/sipeed/NanoKVM)
units: one portal with a host grid showing live preview, power state, ATX power actions
(power/reset/long-press), power consumption (via Home Assistant), and per-host logs (via Grafana Loki).
Clicking a host hands off to the native NanoKVM UI for full interactive control.

> ⚠️ This app can trigger physical **power / reset** of real machines. Run it behind your reverse
> proxy + SSO, never exposed unauthenticated.

## Status

Early development. Architecture, the NanoKVM API spike, and design decisions live in
[`CLAUDE.md`](CLAUDE.md), [`docs/`](docs/), and the plan under `.claude/plans/`.

## Tech

- **Backend:** Fastify + TypeScript (thin proxy/aggregator)
- **Frontend:** React + Vite + TypeScript + Tailwind + shadcn/ui
- **Telemetry:** Server-Sent Events
- **Tooling:** pnpm workspace, ESLint + Prettier, Vitest, Husky + lint-staged, Conventional Commits, GitHub Actions

## Develop

```bash
corepack enable          # provides pnpm (version pinned in package.json)
pnpm install             # installs deps + wires git hooks
pnpm lint                # eslint
pnpm typecheck           # tsc --noEmit across workspaces
pnpm test                # vitest across workspaces
pnpm build               # build all workspaces
```

Git hooks (via Husky): **pre-commit** runs lint-staged (eslint + prettier on staged files),
**pre-push** runs typecheck + tests, **commit-msg** enforces Conventional Commits.
