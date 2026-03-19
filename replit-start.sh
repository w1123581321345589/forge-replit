#!/usr/bin/env bash
# Forge Replit startup script
# Runs on every "Run" press — idempotent

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${GREEN}🔥 Forge${RESET} — agent-first code factory"
echo ""

# ─── 1. Environment ──────────────────────────────────────────────────────────

export PGDATA="${PGDATA:-$HOME/pgdata}"
export DATABASE_URL="${DATABASE_URL:-postgresql://forge:forge@localhost:5432/forge}"
export PORT="${PORT:-3000}"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${YELLOW}⚠  ANTHROPIC_API_KEY not set${RESET}"
  echo "   Set it in Replit Secrets: https://docs.replit.com/programming-ide/workspace-features/storing-sensitive-information"
  echo "   The API will start but spec compilation and code generation won't work."
  echo ""
fi

# ─── 2. Install dependencies ──────────────────────────────────────────────────

echo -e "${DIM}Installing dependencies...${RESET}"
bun install
echo -e "${GREEN}✓${RESET} Dependencies installed"

# ─── 3. Postgres ─────────────────────────────────────────────────────────────

if ! pg_isready -q 2>/dev/null; then
  echo -e "${DIM}Starting Postgres...${RESET}"

  # Init if needed
  if [ ! -d "$PGDATA" ]; then
    initdb -D "$PGDATA" --username=forge --auth=trust --no-instructions -q
    echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
    echo "port = 5432" >> "$PGDATA/postgresql.conf"
  fi

  # Start
  pg_ctl -D "$PGDATA" -l "$HOME/postgres.log" start -w -t 15 -s

  # Create DB if needed
  createdb -U forge forge 2>/dev/null || true

  # Enable pgvector
  psql -U forge -d forge -c "CREATE EXTENSION IF NOT EXISTS vector;" -q 2>/dev/null || true

  echo -e "${GREEN}✓${RESET} Postgres running"
else
  echo -e "${GREEN}✓${RESET} Postgres already running"
fi

# ─── 4. Migrations ───────────────────────────────────────────────────────────

echo -e "${DIM}Running migrations...${RESET}"
bun run db:migrate
echo -e "${GREEN}✓${RESET} Migrations applied"

# ─── 5. Seed (first time only) ───────────────────────────────────────────────

SEEDED_FLAG="$HOME/.forge-seeded"
if [ ! -f "$SEEDED_FLAG" ]; then
  echo -e "${DIM}Seeding sample data...${RESET}"
  bun run db:seed && touch "$SEEDED_FLAG"
  echo -e "${GREEN}✓${RESET} Sample behavioral units created"
else
  echo -e "${GREEN}✓${RESET} Already seeded (delete $SEEDED_FLAG to re-seed)"
fi

# ─── 6. Start API ─────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}Starting Forge API on port $PORT${RESET}"
echo -e "${DIM}  API:     http://localhost:$PORT${RESET}"
echo -e "${DIM}  Health:  http://localhost:$PORT/health${RESET}"
echo -e "${DIM}  Digest:  http://localhost:$PORT/api/digest${RESET}"
echo -e "${DIM}  Graph:   http://localhost:$PORT/api/graph${RESET}"
echo ""
echo -e "${DIM}Run the UI separately: cd apps/ui && bun run dev${RESET}"
echo ""

exec bun run packages/api/src/server.ts
