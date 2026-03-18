# Forge

**A production-ready TypeScript monorepo for orchestrating AI agents.**

Forge is a full-stack framework for building, running, and verifying intelligent agent pipelines. It provides a structured path from a natural-language specification through intent parsing, agent execution, and automated verification — all in a strongly-typed, composable monorepo.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Tests](https://img.shields.io/badge/tests-187%20passing-22c55e)](https://github.com/w1123581321345589/forge-replit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What Forge Does

```
spec.md
  └─▶ @forge/spec-compiler   (parse + validate the specification)
        └─▶ @forge/intent-graph  (resolve intents into an execution graph)
              └─▶ @forge/agents   (run implementer / verifier agents)
                    └─▶ @forge/verification  (automated output verification)
                          └─▶ @forge/api      (REST + WebSocket reporting)
```

The entire pipeline is driven by the `forge` CLI (`@forge/cli`) and backed by a PostgreSQL database (`@forge/db`) with a React web dashboard (`artifacts/home`).

---

## Repository Layout

```
forge-replit/
├── artifacts/
│   ├── api-server/          # Express 5 REST API + WebSocket server
│   └── home/                # React + Vite dashboard / landing page
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks (auto-generated)
│   ├── api-zod/             # Generated Zod schemas (auto-generated)
│   └── db/                  # Drizzle ORM schema + PostgreSQL connection
├── scripts/                 # Utility scripts (seed, healthcheck, …)
├── pnpm-workspace.yaml      # Workspace packages + version catalog
├── tsconfig.base.json       # Shared TypeScript base config
├── tsconfig.json            # Root project references (composite libs)
└── package.json             # Root task orchestration
```

---

## Packages

### `@forge/agents` · `lib/agents`

The agent runtime. Provides a base `Agent` class plus three specialised agents:

| Export | Role |
|---|---|
| `BaseAgent` | Shared lifecycle, logging, retry |
| `ImplementerAgent` | Executes implementation tasks |
| `VerifierAgent` | Runs assertions against outputs |
| `AgentRunner` | Orchestrates a pipeline of agents |
| `AgentScheduler` | Schedules agents across queues |

### `@forge/intent-graph` · `lib/intent-graph`

Parses a compiled spec into a directed acyclic graph (DAG) of intents. Each node in the graph represents an atomic task; edges encode dependencies. The graph is serialisable and replayable.

### `@forge/spec-compiler` · `lib/spec-compiler`

Validates and compiles raw specification files (Markdown, YAML, or JSON) into the normalised `CompiledSpec` type consumed by the intent graph. Supports custom directive plugins.

### `@forge/verification` · `lib/verification`

Runs deterministic and AI-assisted assertions on agent outputs. Integrates with the event bus to publish pass/fail events in real time.

### `@forge/events` · `lib/events`

A typed in-process event bus. All major lifecycle events (`agent:start`, `agent:complete`, `task:failed`, `verify:pass`, …) are published here. Subscribers can be attached at any layer.

### `@forge/types` · `lib/types`

Canonical TypeScript types and Zod schemas shared across every package. Single source of truth for `CompiledSpec`, `Intent`, `AgentResult`, `VerificationReport`, and more.

### `@forge/db` · `lib/db`

Database layer built on **Drizzle ORM** with a **PostgreSQL** backend.

- `src/index.ts` — exports a `Pool` + `db` instance; throws at startup if `DATABASE_URL` is missing
- `src/schema/` — table definitions with `drizzle-zod` insert schemas
- `drizzle.config.ts` — Drizzle Kit config; run `pnpm --filter @workspace/db push` to sync

### `@forge/api` · `artifacts/api-server`

Express 5 HTTP server. Validates every response against Zod schemas generated from the OpenAPI spec.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Server health status |

Additional routes for jobs, events, and agent status are added as the pipeline grows. All endpoints follow the contract defined in `lib/api-spec/openapi.yaml`.

### `@forge/cli` · `lib/cli`

The `forge` command-line interface. Entry point: `bin/forge`.

```bash
forge init <name>            # Scaffold a new Forge project
forge compile <spec>         # Compile a specification file
forge parse --intent "<…>"   # Parse a natural-language intent
forge run                    # Execute the full agent pipeline
forge verify                 # Run the verification suite
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 24 |
| pnpm | ≥ 10 |
| PostgreSQL | ≥ 15 |

### Install

```bash
git clone https://github.com/w1123581321345589/forge-replit.git
cd forge-replit
pnpm install
```

### Environment

Copy `.env.example` and fill in the required values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PORT` | ✅ | Port for the API server |
| `NODE_ENV` | — | `development` \| `production` |

### Database

Push the schema to your local database:

```bash
pnpm --filter @workspace/db run push
```

If the schema has changed and a normal push is rejected, use:

```bash
pnpm --filter @workspace/db run push-force
```

### Run in Development

Start all services concurrently:

```bash
# API server (Express)
pnpm --filter @workspace/api-server run dev

# React dashboard
pnpm --filter @workspace/home run dev
```

Both services are proxied through a shared reverse proxy. Access everything at `localhost:80`:

| Path | Service |
|---|---|
| `/` | React dashboard |
| `/api` | Express API server |

---

## Scripts

Add utility scripts to `scripts/src/` and register them in `scripts/package.json`. Run with:

```bash
pnpm --filter @workspace/scripts run <script-name>
```

Included scripts:

| Script | File | Description |
|---|---|---|
| `seed` | `scripts/src/seed.ts` | Populate the database with sample data |
| `healthcheck` | `scripts/src/healthcheck.ts` | Verify all services are reachable |

---

## Codegen (OpenAPI → TypeScript)

The API contract lives in `lib/api-spec/openapi.yaml`. Whenever the spec changes, regenerate the client and Zod schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This writes into two packages (do **not** edit these files manually):

| Package | Output |
|---|---|
| `@workspace/api-client-react` | React Query hooks (`generated/api.ts`) |
| `@workspace/api-zod` | Zod schemas (`generated/api.ts`) |

---

## TypeScript

The monorepo uses TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html). `lib/*` packages are **composite** (emit `.d.ts`); `artifacts/*` are leaf packages.

```bash
# Full typecheck (recommended — respects dependency order)
pnpm run typecheck

# Build all packages
pnpm run build
```

> **Tip:** Always run `pnpm run typecheck` from the root rather than inside individual packages. The root command uses `tsc --build` which resolves the full reference graph.

---

## Testing

```bash
# Run all tests across all packages
pnpm -r run test

# Run tests in a specific package
pnpm --filter @workspace/agents run test
```

**187 tests across 11 test files, all passing.**

| Package | Test files |
|---|---|
| `@forge/types` | `schemas.test.ts` |
| `@forge/events` | `events.test.ts` |
| `@forge/db` | `db.test.ts` |
| `@forge/intent-graph` | `graph.test.ts`, `integration.test.ts` |
| `@forge/spec-compiler` | `compiler.test.ts`, `integration.test.ts` |
| `@forge/verification` | `verification.test.ts`, `integration.test.ts` |
| `@forge/agents` | `agents.test.ts`, `implementer.test.ts`, `verifier.test.ts`, `runner.test.ts` |
| `@forge/api` | `api.test.ts`, `e2e.test.ts` |
| `@forge/cli` | `cli.test.ts` |

---

## Production Build

```bash
pnpm run build
```

This runs `typecheck` first, then produces:

- `artifacts/api-server/dist/index.cjs` — bundled Express server (esbuild, CJS)
- `artifacts/home/dist/public/` — static React app (Vite)

The API bundle inlines its runtime dependencies (express, drizzle-orm, pg, zod, etc.) and externalises the rest.

---

## Project Conventions

- **OpenAPI-first** — every API endpoint must be defined in `openapi.yaml` before implementation
- **Zod everywhere** — request/response validation uses generated Zod schemas; no manual `any`
- **One schema per file** — each database table lives in its own file under `lib/db/src/schema/`
- **Catalog versions** — shared dependency versions are pinned in `pnpm-workspace.yaml`; use `catalog:` in `package.json`
- **Leaf vs. composite** — `lib/*` packages are composite; `artifacts/*` and `scripts` are not; never add leaf packages to the root `tsconfig.json` references

---

## Architecture Decision Records

Full architecture notes live in `ARCHITECTURE.md`. Key decisions:

- **pnpm workspaces** over npm/yarn for faster installs, strict isolation, and catalog-pinned versions
- **Drizzle ORM** over Prisma for zero-runtime codegen and first-class SQL
- **Orval** over openapi-generator because it targets React Query + Zod natively
- **Express 5** for async/await support and better error propagation out of the box
- **esbuild** for production bundling — sub-second builds with tree-shaking

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Quick summary:

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Create a feature branch: `git checkout -b feat/my-feature`
4. Make changes and add tests
5. Verify everything passes: `pnpm run typecheck && pnpm -r run test`
6. Open a pull request

---

## License

MIT — see [LICENSE](LICENSE) for details.
