# Forge

**The agent-first code factory.**

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-orange)](https://bun.sh)
[![v0.1.0](https://img.shields.io/badge/version-0.1.0-green)](CHANGELOG.md)
[![CI](https://github.com/willrose/forge/actions/workflows/ci.yml/badge.svg)](https://github.com/willrose/forge/actions/workflows/ci.yml)

---

Every current coding tool makes the same mistake: git is infrastructure, files are the atomic unit, line diffs are the change primitive. These were designed for humans reading code. When agents write and read code, optimizing for human readability is waste.

**Forge inverts this.** Intent is the primary artifact. Code is compiled from it.

You write behavioral claims. Agents implement, verify, and deploy against them. Where agents need human judgment, a chief-of-staff agent surfaces exactly one ask — twice a day.

---

## How it works

```bash
forge spec "Authenticated users can reset their password via email.
            The reset link expires after 1 hour."
```

The spec compiler parses this into an intent graph of `BehavioralUnit`s — each one a testable behavioral claim with constraints and acceptance criteria. Agents implement, verify, and track every claim. You never look at a file unless you want to.

```bash
forge status        # intent graph by domain
forge digest        # what shipped, what's stuck, one ask from your CoS
forge gaps          # where agents needed you — your R&D roadmap
forge diff v1 v2    # what changed between deployments, semantically
```

![Forge UI — intent map, chief-of-staff digest, and autonomy gap tracker](screenshots/ui-preview.png)

*Intent map (force-directed, color = status), CoS inbox with the one ask, gap tracker with velocity trend.*

---

## The mental model shift

| SDLC 1.0 | Forge |
|---|---|
| File tree | Intent graph |
| Line diff | Behavioral transition |
| PR review | Behavioral verification |
| Issue tracker | Spec compiler |
| Merge conflict | Claim contradiction |
| CI/CD | Verification runtime |

---

## Architecture

```
packages/
├── types/          Zod schemas → TypeScript types
├── db/             Postgres + pgvector, migrations, vector search
├── events/         Shared broadcaster (no circular deps)
├── intent-graph/   BU CRUD, DAG, cascade propagation, autonomy gap tracking
├── spec-compiler/  NL → TaskGraph, quality gating, conflict detection
├── verification/   Claim parsing, behavioral verification, regression detection
├── agents/         Implementer (tournament), Verifier (anti-gaming), Chief-of-Staff
├── api/            Hono REST + Bun WebSocket + SSE, 30+ endpoints
└── cli/            forge spec / status / digest / gaps / diff / run / watch
apps/ui/            React: intent map, CoS inbox, gap tracker, diff view, activity feed
```

**Security is structural, not prompt-based.** Every agent action is logged with its security decision before it executes. Hard blocks on auth/billing/deploy. The Polsia lesson — agents route around prompt guardrails — is handled at the action-log boundary.

**You manage one agent.** The chief-of-staff agent manages the rest and surfaces one clear ask, twice a day. The `autonomy_gaps` table is your R&D roadmap: where gaps cluster is where to invest.

---

## Quickstart

**Prerequisites:** [Bun v1.0+](https://bun.sh), Docker

```bash
git clone https://github.com/willrose/forge
cd forge
cp .env.example .env        # add ANTHROPIC_API_KEY
make setup                  # Postgres + pgvector + migrations
make seed                   # 10 sample BUs across auth/users/billing
make dev                    # API on :3000, UI on :5173
```

**Try it:**
```bash
forge spec "Authenticated admin users can export all user records as CSV. The export includes email, created_at, and plan. Must complete in under 60 seconds."
forge status
forge digest
```

---

## Try on Replit

1. Create a new Replit, upload `forge-replit.zip`
2. Add `ANTHROPIC_API_KEY` to Replit Secrets
3. Hit **Run** — Postgres starts, migrations run, data seeds, API starts in ~30 seconds

---

## Tests

```bash
make test              # 16 test files, all unit, no network, no DB required
make test-integration  # needs live Postgres
make test-llm          # needs ANTHROPIC_API_KEY
make healthcheck       # validates full stack before going live
```

---

## Production

```bash
make build-ui    # builds React app into apps/ui/dist
make deploy      # docker-compose.prod.yml: Postgres + API + Scheduler
```

The API serves the built UI directly. Everything on port 3000.

---

## Why not gstack / Cursor / Devin?

They're right about role separation. Wrong about the primitive.

Every tool that wraps agents around git hits the same ceiling: merge conflicts are still text diffs, PR reviews are still humans reading code, CI failures are still "test_auth_login failed" not "the auth claim is violated."

Forge makes behavioral claims the source of truth. When a claim at the root of the graph changes, the system propagates `needs_reverification` to every dependent claim automatically. No human traces the cascade. That's the inversion. Everything else follows from it.

---

## Status

`v0.1.0` — initial public release. Single-tenant, Anthropic-first.

[CHANGELOG](CHANGELOG.md) · [ARCHITECTURE](ARCHITECTURE.md) · [CONTRIBUTING](CONTRIBUTING.md)

---

## License

MIT
