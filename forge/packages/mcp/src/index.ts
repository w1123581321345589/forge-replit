#!/usr/bin/env node
/**
 * Forge MCP Server — Command Center integration bridge.
 *
 * Exposes Forge's intent graph as MCP tools so the Command Center
 * (and any MCP-compatible client: Claude Code, Cursor, etc.) can
 * orchestrate across all intent graphs simultaneously.
 *
 * Tools exposed:
 *   forge_compile_spec     — compile NL spec into BUs (with optional CEO review)
 *   forge_get_graph        — get the current intent graph snapshot
 *   forge_get_annotations  — get domain knowledge for a domain
 *   forge_run_batch        — queue BUs for agent implementation
 *   forge_get_production   — get production health across all BUs
 *   forge_get_retro        — get weekly retrospective
 *   forge_get_cost         — get cost breakdown
 *   forge_record_annotation — teach Forge something new
 *   forge_get_gaps         — get unresolved autonomy gaps (CoS inbox)
 *   forge_resolve_gap      — resolve a gap (resolution becomes an annotation)
 *
 * Usage:
 *   bun run packages/mcp/src/index.ts    (stdio transport — for Claude Code)
 *   FORGE_MCP_PORT=3001 bun run ...      (HTTP/SSE transport — for Replit)
 *
 * Add to Claude Code:
 *   claude mcp add forge "bun run /path/to/forge/packages/mcp/src/index.ts"
 *
 * Env vars:
 *   FORGE_API        — Forge API base URL (default: http://localhost:3000)
 *   FORGE_API_KEY    — API key (if set on Forge server)
 *   FORGE_MCP_PORT   — Port for HTTP transport (default: stdio)
 */

const FORGE_API = process.env["FORGE_API"] ?? "http://localhost:3000";
const API_KEY = process.env["FORGE_API_KEY"];

async function forgeCall<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const res = await fetch(`${FORGE_API}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Forge API ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "forge_compile_spec",
    description: "Compile a natural language spec into behavioral units in the Forge intent graph. Optionally run CEO review first to ensure you're building the 10-star version.",
    inputSchema: {
      type: "object",
      properties: {
        specText: { type: "string", description: "The feature specification in natural language" },
        ceoReview: { type: "boolean", description: "Run CEO review first (checks if this is the 10-star version)", default: false },
      },
      required: ["specText"],
    },
  },
  {
    name: "forge_get_graph",
    description: "Get the current Forge intent graph — all behavioral units, their status, and dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter by domain (e.g. auth, billing)" },
        status: { type: "string", description: "Filter by status (proposed, verified, deployed, needs_reverification)" },
      },
    },
  },
  {
    name: "forge_get_annotations",
    description: "Get domain knowledge annotations — what Forge agents have learned about a domain. Inject this into your own prompts before implementing.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to get annotations for (e.g. billing, auth, oncology)" },
      },
      required: ["domain"],
    },
  },
  {
    name: "forge_run_batch",
    description: "Queue a batch of behavioral units for agent implementation and verification.",
    inputSchema: {
      type: "object",
      properties: {
        buIds: { type: "array", items: { type: "string" }, description: "BU IDs to queue" },
        domain: { type: "string", description: "Queue all proposed BUs in this domain" },
      },
    },
  },
  {
    name: "forge_get_production",
    description: "Get production health — which behavioral claims are being monitored and whether they're passing.",
    inputSchema: {
      type: "object",
      properties: {
        buId: { type: "string", description: "Filter to a specific BU" },
      },
    },
  },
  {
    name: "forge_get_retro",
    description: "Get the weekly engineering retrospective — what shipped, satisfaction rates, cost, where agents got stuck.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter by domain" },
      },
    },
  },
  {
    name: "forge_get_cost",
    description: "Get token cost breakdown by domain and per BU.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter by domain" },
        top: { type: "number", description: "Number of top expensive BUs to return", default: 10 },
      },
    },
  },
  {
    name: "forge_record_annotation",
    description: "Teach Forge something new — record domain knowledge that all future agents in this domain will see.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain (e.g. billing, auth, oncology)" },
        key: { type: "string", description: "Specific key (e.g. stripe/webhooks, jwt/expiry)" },
        title: { type: "string", description: "Short title" },
        content: { type: "string", description: "The knowledge to record (markdown)" },
        contentType: { type: "string", enum: ["pattern", "gotcha", "example", "constraint"], default: "gotcha" },
      },
      required: ["domain", "key", "title", "content"],
    },
  },
  {
    name: "forge_get_gaps",
    description: "Get unresolved autonomy gaps — where agents got stuck and need human input.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter by domain" },
        gapType: { type: "string", description: "Filter by gap type" },
      },
    },
  },
  {
    name: "forge_resolve_gap",
    description: "Resolve an autonomy gap with a human answer. The resolution automatically becomes a domain annotation.",
    inputSchema: {
      type: "object",
      properties: {
        gapId: { type: "string", description: "Gap ID to resolve" },
        resolution: { type: "string", description: "The answer / resolution" },
        resolvedBy: { type: "string", description: "Who is resolving (e.g. 'will@forge')" },
        rationale: { type: "string", description: "Optional rationale" },
      },
      required: ["gapId", "resolution", "resolvedBy"],
    },
  },
  {
    name: "forge_get_portfolio",
    description: "Snapshot of all 5 companies (Aiglos, InstantPrequal, Strider, TPM, CofC) — BU counts by status. Use this first every morning.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "forge_dispatch",
    description: "Dispatch a task from the Command Center to a specific company workspace. Compiles description → BUs → optionally runs agents.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["aiglos", "instantprequal", "strider", "tpm", "cofcgs"] },
        description: { type: "string", description: "Task description (natural language spec)" },
        domain: { type: "string", description: "Domain (e.g. security, compliance, core, fintech)" },
        priority: { type: "string", enum: ["immediate", "today", "this_week"], default: "today" },
        ceoReview: { type: "boolean", default: false },
        runImmediately: { type: "boolean", default: false },
      },
      required: ["company", "description", "domain"],
    },
  },
  {
    name: "forge_propagate_annotation",
    description: "Push a domain annotation across all company workspaces. Use when a gotcha found in Aiglos is relevant to Strider's billing domain.",
    inputSchema: {
      type: "object",
      properties: {
        annotationId: { type: "string" },
        targetCompanies: { type: "array", items: { type: "string" } },
      },
      required: ["annotationId"],
    },
  },
];

// ─── Tool handlers ─────────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "forge_compile_spec":
      return forgeCall("/api/specs", {
        method: "POST",
        body: { specText: args["specText"], ceoReview: args["ceoReview"] ?? false },
      });

    case "forge_get_graph": {
      const qs = new URLSearchParams();
      if (args["domain"]) qs.set("domain", String(args["domain"]));
      if (args["status"]) qs.set("status", String(args["status"]));
      return forgeCall(`/api/graph?${qs}`);
    }

    case "forge_get_annotations":
      return forgeCall(`/api/annotations/${encodeURIComponent(String(args["domain"]))}`);

    case "forge_run_batch":
      return forgeCall("/api/run", {
        method: "POST",
        body: { buIds: args["buIds"], domain: args["domain"] },
      });

    case "forge_get_production": {
      const qs = args["buId"] ? `?buId=${args["buId"]}` : "";
      return forgeCall(`/api/probes/health${qs}`);
    }

    case "forge_get_retro": {
      const qs = args["domain"] ? `?domain=${args["domain"]}` : "";
      return forgeCall(`/api/retro${qs}`);
    }

    case "forge_get_cost": {
      const qs = new URLSearchParams();
      if (args["domain"]) qs.set("domain", String(args["domain"]));
      if (args["top"]) qs.set("limit", String(args["top"]));
      const [byBU, byDomain] = await Promise.all([
        forgeCall(`/api/cost/by-bu?${qs}`),
        forgeCall("/api/cost/by-domain"),
      ]);
      return { byBU, byDomain };
    }

    case "forge_record_annotation":
      return forgeCall("/api/annotations", {
        method: "POST",
        body: {
          domain: args["domain"],
          key: args["key"],
          title: args["title"],
          content: args["content"],
          contentType: args["contentType"] ?? "gotcha",
          agentRole: "human",
        },
      });

    case "forge_get_gaps": {
      const qs = new URLSearchParams();
      if (args["domain"]) qs.set("domain", String(args["domain"]));
      if (args["gapType"]) qs.set("gapType", String(args["gapType"]));
      return forgeCall(`/api/gaps?${qs}`);
    }

    case "forge_resolve_gap":
      return forgeCall(`/api/gaps/${args["gapId"]}/resolve`, {
        method: "POST",
        body: { resolution: args["resolution"], resolvedBy: args["resolvedBy"], rationale: args["rationale"] },
      });

    case "forge_get_portfolio":
      return forgeCall("/api/cc/portfolio");

    case "forge_dispatch":
      return forgeCall("/api/cc/dispatch", {
        method: "POST",
        body: {
          company: args["company"],
          description: args["description"],
          domain: args["domain"],
          priority: args["priority"] ?? "today",
          ceoReview: args["ceoReview"] ?? false,
          runImmediately: args["runImmediately"] ?? false,
        },
      });

    case "forge_propagate_annotation":
      return forgeCall("/api/cc/propagate-annotation", {
        method: "POST",
        body: { annotationId: args["annotationId"], targetCompanies: args["targetCompanies"] },
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP stdio server ─────────────────────────────────────────────────────────

async function runStdioServer() {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  const send = (message: unknown) => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  rl.on("line", async (line) => {
    let msg: { jsonrpc: string; id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0", id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "forge-mcp", version: "0.1.0" },
        },
      });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    } else if (msg.method === "tools/call") {
      const { name, arguments: args = {} } = (msg.params ?? {}) as { name: string; arguments?: Record<string, unknown> };
      try {
        const result = await handleTool(name, args);
        send({
          jsonrpc: "2.0", id: msg.id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        });
      } catch (e) {
        send({
          jsonrpc: "2.0", id: msg.id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        });
      }
    } else if (msg.method === "notifications/initialized") {
      // ack
    }
  });

  process.stderr.write(`[forge-mcp] Started. Connecting to ${FORGE_API}\n`);
}

runStdioServer();
