import { Router } from "express";

const router = Router();

// ─── Quality Scoring (ported from @forge/spec-compiler) ───────────────────────

function scoreQuality(spec: string) {
  const wordCount = spec.split(/\s+/).length;

  const concreteTerms =
    /\b(user|admin|api|endpoint|database|email|password|id|uuid|token|stripe|webhook|table|schema|jwt|oauth|role|permission)\b/gi;
  const concreteCount = (spec.match(concreteTerms) ?? []).length;
  const specificity = Math.min(100, 20 + concreteCount * 8 + (wordCount > 25 ? 20 : 0));

  const testableSignals =
    /\b(when|if|should|must|returns|displays|sends|creates|updates|deletes|validates|requires|prevents|allows|blocks)\b/gi;
  const testableCount = (spec.match(testableSignals) ?? []).length;
  const testability = Math.min(100, testableCount * 15);

  const vagueTerms = /\b(things|stuff|etc|maybe|kind of|sort of|better|improve|various|some|nice|good)\b/gi;
  const vagueCount = (spec.match(vagueTerms) ?? []).length;
  const scopeClarity = Math.max(0, 100 - vagueCount * 20);

  const actorTerms = /\b(user|admin|system|api|customer|guest|authenticated|anonymous|visitor|owner)\b/gi;
  const actorCount = (spec.match(actorTerms) ?? []).length;
  const actorDefinition = Math.min(100, actorCount * 20 + (actorCount > 0 ? 20 : 0));

  const overall = Math.round((specificity + testability + scopeClarity + actorDefinition) / 4);
  return { specificity, testability, scopeClarity, actorDefinition, overall };
}

// ─── Ambiguity Detection ──────────────────────────────────────────────────────

interface Ambiguity {
  type: string;
  fragment: string;
  question: string;
  severity: "blocking" | "warning" | "info";
  suggestion?: string;
}

function detectAmbiguities(spec: string): Ambiguity[] {
  const flags: Ambiguity[] = [];

  const vaguePerf = /\b(fast|slow|quick|responsive|performant|scalable|efficient)\b/gi;
  for (const m of spec.matchAll(vaguePerf)) {
    flags.push({
      type: "unquantified_constraint",
      fragment: m[0],
      question: `"${m[0]}" needs a specific threshold — e.g., "< 200ms at p99"`,
      severity: "warning",
      suggestion: "Add a measurable SLA like '< 200ms for 95th percentile'",
    });
  }

  if (!/\b(user|admin|customer|system|api|authenticated|anonymous|owner)\b/i.test(spec)) {
    flags.push({
      type: "missing_actor",
      fragment: spec.substring(0, 40).trim(),
      question: "Who performs this action? (e.g., authenticated user, admin, anonymous visitor)",
      severity: "blocking",
    });
  }

  const vagueScope = /\b(etc|and so on|similar|other things|various|etc\.)\b/gi;
  for (const m of spec.matchAll(vagueScope)) {
    flags.push({
      type: "scope_unclear",
      fragment: m[0],
      question: `"${m[0]}" is ambiguous — enumerate the specific items you mean`,
      severity: "blocking",
    });
  }

  const vagueData = /\b(some data|information|details|stuff|content)\b/gi;
  for (const m of spec.matchAll(vagueData)) {
    flags.push({
      type: "underspecified_data",
      fragment: m[0],
      question: `"${m[0]}" — what specific fields or schema do you need?`,
      severity: "warning",
    });
  }

  return flags;
}

// ─── Intent Extraction ────────────────────────────────────────────────────────

interface Intent {
  id: string;
  action: string;
  target: string;
  type: "db" | "agent" | "verification" | "migration" | "config";
  order: number;
  estimatedLines: number;
  dependencies: string[];
  badge: string;
}

const DOMAIN_PATTERNS: Record<string, RegExp> = {
  auth: /\b(auth(?:entication|orization)?|login|logout|register|sign.?(?:in|up|out)|password|token|jwt|session|oauth|role|permission|refresh)\b/i,
  user: /\b(user|account|profile|avatar|member|subscriber|admin)\b/i,
  db: /\b(database|schema|table|model|column|field|index|migration|record|store|persist|drizzle|postgres|sql)\b/i,
  api: /\b(endpoint|route|api|rest|graphql|http|controller|handler|request|response|middleware)\b/i,
  email: /\b(email|e-mail|notification|smtp|send|template|mailbox|inbox)\b/i,
  payment: /\b(payment|stripe|checkout|subscription|invoice|billing|card|charge|refund|plan)\b/i,
  search: /\b(search|filter|sort|paginate|query|full.text|fuzzy|elastic|vector|embedding)\b/i,
  file: /\b(upload|file|image|photo|media|storage|s3|cdn|attachment)\b/i,
  cache: /\b(cache|redis|rate.limit|throttle|queue|job|worker|background)\b/i,
  realtime: /\b(websocket|realtime|real-time|socket\.io|push|stream|live|broadcast)\b/i,
  test: /\b(test|spec|assert|verify|validate|check|coverage)\b/i,
};

const DOMAIN_INTENTS: Record<
  string,
  Array<{ action: string; target: string; type: Intent["type"]; lines: number; depKeys: string[] }>
> = {
  auth: [
    { action: "create", target: "users_table",        type: "db",           lines: 48,  depKeys: [] },
    { action: "implement", target: "jwt_middleware",   type: "agent",        lines: 87,  depKeys: ["auth:0"] },
    { action: "implement", target: "auth_routes",      type: "agent",        lines: 134, depKeys: ["auth:1"] },
    { action: "implement", target: "refresh_tokens",   type: "agent",        lines: 68,  depKeys: ["auth:1"] },
    { action: "test",      target: "auth_flow",        type: "verification", lines: 42,  depKeys: ["auth:2"] },
    { action: "test",      target: "token_expiry",     type: "verification", lines: 31,  depKeys: ["auth:3"] },
  ],
  user: [
    { action: "create",    target: "user_profiles",    type: "db",           lines: 35,  depKeys: [] },
    { action: "implement", target: "profile_api",      type: "agent",        lines: 91,  depKeys: ["user:0"] },
    { action: "test",      target: "profile_crud",     type: "verification", lines: 38,  depKeys: ["user:1"] },
  ],
  email: [
    { action: "implement", target: "email_service",    type: "agent",        lines: 74,  depKeys: [] },
    { action: "implement", target: "email_templates",  type: "agent",        lines: 52,  depKeys: ["email:0"] },
    { action: "test",      target: "email_delivery",   type: "verification", lines: 28,  depKeys: ["email:0"] },
  ],
  payment: [
    { action: "create",    target: "payments_table",   type: "db",           lines: 55,  depKeys: [] },
    { action: "implement", target: "stripe_webhook",   type: "agent",        lines: 112, depKeys: ["payment:0"] },
    { action: "implement", target: "checkout_handler", type: "agent",        lines: 98,  depKeys: ["payment:0"] },
    { action: "test",      target: "payment_flow",     type: "verification", lines: 47,  depKeys: ["payment:1", "payment:2"] },
  ],
  search: [
    { action: "migrate",   target: "add_search_indexes", type: "migration",  lines: 22,  depKeys: [] },
    { action: "implement", target: "search_service",   type: "agent",        lines: 108, depKeys: ["search:0"] },
    { action: "implement", target: "search_api",       type: "agent",        lines: 64,  depKeys: ["search:1"] },
    { action: "test",      target: "search_relevance", type: "verification", lines: 35,  depKeys: ["search:2"] },
  ],
  file: [
    { action: "implement", target: "upload_handler",   type: "agent",        lines: 88,  depKeys: [] },
    { action: "implement", target: "storage_service",  type: "agent",        lines: 71,  depKeys: ["file:0"] },
    { action: "test",      target: "upload_flow",      type: "verification", lines: 33,  depKeys: ["file:0"] },
  ],
  cache: [
    { action: "config",    target: "redis_connection", type: "config",       lines: 24,  depKeys: [] },
    { action: "implement", target: "cache_middleware",  type: "agent",        lines: 56,  depKeys: ["cache:0"] },
    { action: "implement", target: "rate_limiter",     type: "agent",        lines: 44,  depKeys: ["cache:0"] },
    { action: "test",      target: "rate_limiting",    type: "verification", lines: 29,  depKeys: ["cache:2"] },
  ],
  realtime: [
    { action: "implement", target: "ws_server",        type: "agent",        lines: 96,  depKeys: [] },
    { action: "implement", target: "event_broadcaster", type: "agent",       lines: 67,  depKeys: ["realtime:0"] },
    { action: "test",      target: "ws_connections",   type: "verification", lines: 41,  depKeys: ["realtime:1"] },
  ],
  api: [
    { action: "implement", target: "rest_router",      type: "agent",        lines: 78,  depKeys: [] },
    { action: "implement", target: "error_handler",    type: "agent",        lines: 34,  depKeys: ["api:0"] },
    { action: "test",      target: "api_endpoints",    type: "verification", lines: 44,  depKeys: ["api:0"] },
  ],
  db: [
    { action: "migrate",   target: "initial_schema",   type: "migration",    lines: 31,  depKeys: [] },
    { action: "create",    target: "base_models",      type: "db",           lines: 58,  depKeys: ["db:0"] },
    { action: "test",      target: "db_integrity",     type: "verification", lines: 26,  depKeys: ["db:1"] },
  ],
};

function extractIntents(spec: string): Intent[] {
  const detected: string[] = [];
  for (const [domain, pattern] of Object.entries(DOMAIN_PATTERNS)) {
    if (pattern.test(spec)) detected.push(domain);
  }

  // Always need at least api + test if nothing matches
  if (detected.length === 0) detected.push("api");

  // Smart de-duplication: if "auth" detected, "user" is implicit
  if (detected.includes("auth") && !detected.includes("user")) {
    // skip adding standalone user table since auth includes users_table
  }
  if (detected.includes("auth") && detected.includes("user")) {
    // remove user if auth is present (auth already has users_table)
    const idx = detected.indexOf("user");
    detected.splice(idx, 1);
  }

  // Build intents with resolved IDs
  const allIntents: Intent[] = [];
  const keyToId: Record<string, string> = {};

  for (const domain of detected) {
    const templates = DOMAIN_INTENTS[domain];
    if (!templates) continue;

    templates.forEach((t, i) => {
      const key = `${domain}:${i}`;
      const id = `${domain[0]!.toUpperCase()}${i + 1}`;
      keyToId[key] = id;
    });
  }

  let order = 1;
  for (const domain of detected) {
    const templates = DOMAIN_INTENTS[domain];
    if (!templates) continue;

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i]!;
      const key = `${domain}:${i}`;
      const id = keyToId[key]!;
      const deps = t.depKeys.map((k) => keyToId[k] ?? "").filter(Boolean);

      const badge =
        t.type === "db" ? "db" :
        t.type === "migration" ? "migrate" :
        t.type === "config" ? "config" :
        t.type === "verification" ? "test" :
        "agent";

      allIntents.push({
        id,
        action: t.action,
        target: t.target,
        type: t.type,
        order: order++,
        estimatedLines: t.lines,
        dependencies: deps,
        badge,
      });
    }
  }

  return allIntents;
}

// ─── Execution Group Calculation ─────────────────────────────────────────────

function calcExecutionGroups(intents: Intent[]): number {
  const idToGroup: Record<string, number> = {};
  const idSet = new Set(intents.map((i) => i.id));

  for (const intent of intents) {
    if (intent.dependencies.length === 0) {
      idToGroup[intent.id] = 0;
    } else {
      const maxDep = Math.max(...intent.dependencies.filter((d) => idSet.has(d)).map((d) => idToGroup[d] ?? 0));
      idToGroup[intent.id] = maxDep + 1;
    }
  }

  return Math.max(...Object.values(idToGroup), 0) + 1;
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/compile", (req, res) => {
  const start = Date.now();
  const spec: string = (req.body?.spec ?? "").trim();

  if (!spec) {
    res.status(400).json({ error: "spec is required" });
    return;
  }
  if (spec.length < 10) {
    res.status(400).json({ error: "spec is too short — describe what to build" });
    return;
  }

  const quality = scoreQuality(spec);
  const ambiguities = detectAmbiguities(spec);
  const intents = extractIntents(spec);

  const totalLines = intents.reduce((s, i) => s + i.estimatedLines, 0);
  const testCount = intents.filter((i) => i.type === "verification").length;
  const executionGroups = calcExecutionGroups(intents);

  res.json({
    compileTime: Date.now() - start,
    quality,
    ambiguities,
    intents,
    stats: {
      totalIntents: intents.length,
      estimatedLines: totalLines,
      estimatedTests: testCount * 8,
      executionGroups,
    },
  });
});

export default router;
