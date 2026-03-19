import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Zap, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { useLocation } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PLACEHOLDER = `An authenticated user can register with email and password.
The system validates email format and enforces a minimum 8-character password.
After registration, the user receives a verification email.
JWT tokens expire after 24 hours with refresh token support.
Failed login attempts are rate-limited to 5 per minute.`;

interface Quality {
  overall: number;
  specificity: number;
  testability: number;
  scopeClarity: number;
  actorDefinition: number;
}

interface Ambiguity {
  type: string;
  fragment: string;
  question: string;
  severity: "blocking" | "warning" | "info";
  suggestion?: string;
}

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

interface InferredProbe {
  intentId: string;
  intentTarget: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  expectedStatus: number[];
  expectedLatencyMs: number | null;
  rationale: string;
  schedule: string;
}

interface CompileResult {
  compileTime: number;
  quality: Quality;
  ambiguities: Ambiguity[];
  intents: Intent[];
  probes: InferredProbe[];
  stats: {
    totalIntents: number;
    estimatedLines: number;
    estimatedTests: number;
    executionGroups: number;
    probeCount: number;
  };
}

// ─── DAG Layout ──────────────────────────────────────────────────────────────

function computeLayout(intents: Intent[]): Map<string, { x: number; y: number; layer: number }> {
  const idSet = new Set(intents.map((i) => i.id));
  const layers: Record<string, number> = {};

  // Topological layer assignment
  const visited = new Set<string>();
  function getLayer(id: string): number {
    if (id in layers) return layers[id]!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const intent = intents.find((i) => i.id === id);
    if (!intent || intent.dependencies.length === 0) {
      layers[id] = 0;
      return 0;
    }
    const maxDep = Math.max(...intent.dependencies.filter((d) => idSet.has(d)).map(getLayer));
    layers[id] = maxDep + 1;
    return layers[id]!;
  }
  intents.forEach((i) => getLayer(i.id));

  const maxLayer = Math.max(...Object.values(layers), 0);
  const layerNodes: Record<number, string[]> = {};
  for (let l = 0; l <= maxLayer; l++) layerNodes[l] = [];
  for (const [id, layer] of Object.entries(layers)) {
    layerNodes[layer]?.push(id);
  }

  const NODE_W = 160;
  const NODE_H = 72;
  const GAP_X = 48;
  const GAP_Y = 56;

  const positions = new Map<string, { x: number; y: number; layer: number }>();

  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodes = layerNodes[layer] ?? [];
    nodes.forEach((id, i) => {
      const x = layer * (NODE_W + GAP_X);
      const y = i * (NODE_H + GAP_Y);
      positions.set(id, { x, y, layer });
    });
  }

  return positions;
}

// ─── Node Component ──────────────────────────────────────────────────────────

const TYPE_COLORS = {
  db:           { bg: "#0d1f3b", border: "#1e4d8c", label: "#60a5fa", dot: "#3b82f6" },
  migration:    { bg: "#1a120d", border: "#8c4a1e", label: "#fb923c", dot: "#f97316" },
  config:       { bg: "#141a0d", border: "#4a8c1e", label: "#86efac", dot: "#22c55e" },
  agent:        { bg: "#0d1f2e", border: "#00617a", label: "#00D4FF", dot: "#00D4FF" },
  verification: { bg: "#0a1f14", border: "#1e6b3c", label: "#4ade80", dot: "#22c55e" },
};

function IntentNode({
  intent,
  x,
  y,
  index,
}: {
  intent: Intent;
  x: number;
  y: number;
  index: number;
}) {
  const colors = TYPE_COLORS[intent.type] ?? TYPE_COLORS.agent;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <rect
        x={x}
        y={y}
        width={160}
        height={72}
        rx={2}
        fill={colors.bg}
        stroke={colors.border}
        strokeWidth={1}
      />
      {/* badge */}
      <rect x={x + 10} y={y + 10} width={44} height={16} rx={2} fill={colors.border} />
      <text
        x={x + 32}
        y={y + 22}
        textAnchor="middle"
        fill={colors.label}
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
        fontWeight={700}
        letterSpacing={0.5}
      >
        {intent.badge.toUpperCase()}
      </text>
      {/* order */}
      <text
        x={x + 150}
        y={y + 22}
        textAnchor="end"
        fill="rgba(255,255,255,0.2)"
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
      >
        {String(intent.order).padStart(2, "0")}
      </text>
      {/* target */}
      <text
        x={x + 10}
        y={y + 46}
        fill="rgba(255,255,255,0.85)"
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
        fontWeight={500}
      >
        {intent.target.length > 18 ? intent.target.slice(0, 17) + "…" : intent.target}
      </text>
      {/* lines estimate */}
      <text
        x={x + 10}
        y={y + 62}
        fill="rgba(255,255,255,0.3)"
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
      >
        ~{intent.estimatedLines} lines
      </text>
      {/* dot */}
      <circle cx={x + 155} cy={y + 36} r={3} fill={colors.dot} opacity={0.8} />
    </motion.g>
  );
}

function DAGArrow({ x1, y1, x2, y2, index }: { x1: number; y1: number; x2: number; y2: number; index: number }) {
  const mx = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="rgba(255,255,255,0.08)"
      strokeWidth={1.5}
      markerEnd="url(#arrow)"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, delay: index * 0.03 + 0.2 }}
    />
  );
}

function DAGView({ intents }: { intents: Intent[] }) {
  const positions = computeLayout(intents);

  const NODE_W = 160;
  const NODE_H = 72;
  const PADDING = 24;

  const allX = [...positions.values()].map((p) => p.x);
  const allY = [...positions.values()].map((p) => p.y);
  const svgW = (allX.length ? Math.max(...allX) + NODE_W : NODE_W) + PADDING * 2;
  const svgH = (allY.length ? Math.max(...allY) + NODE_H : NODE_H) + PADDING * 2;

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const intent of intents) {
    const to = positions.get(intent.id);
    if (!to) continue;
    for (const depId of intent.dependencies) {
      const from = positions.get(depId);
      if (!from) continue;
      edges.push({
        x1: from.x + NODE_W + PADDING,
        y1: from.y + NODE_H / 2 + PADDING,
        x2: to.x + PADDING,
        y2: to.y + NODE_H / 2 + PADDING,
      });
    }
  }

  return (
    <div className="overflow-auto w-full h-full">
      <svg
        width={svgW}
        height={svgH}
        style={{ minWidth: svgW, minHeight: svgH }}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,255,255,0.15)" />
          </marker>
        </defs>
        {edges.map((e, i) => (
          <DAGArrow key={i} {...e} index={i} />
        ))}
        {intents.map((intent, i) => {
          const pos = positions.get(intent.id);
          if (!pos) return null;
          return (
            <IntentNode
              key={intent.id}
              intent={intent}
              x={pos.x + PADDING}
              y={pos.y + PADDING}
              index={i}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ─── Quality Bar ─────────────────────────────────────────────────────────────

function QualityBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "#00D4FF" : value >= 40 ? "#fb923c" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-white/30 w-20 shrink-0 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="text-[10px] font-mono w-6 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Probes Panel ────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET:    { bg: "#0d2a1e", text: "#4ade80" },
  POST:   { bg: "#0d1f3b", text: "#60a5fa" },
  PUT:    { bg: "#1a1a08", text: "#facc15" },
  DELETE: { bg: "#2a0d0d", text: "#f87171" },
  PATCH:  { bg: "#1a0d2a", text: "#c084fc" },
};

function ProbesPanel({ probes, intents }: { probes: InferredProbe[]; intents: Intent[] }) {
  const intentMap = new Map(intents.map((i) => [i.id, i]));
  if (probes.length === 0) return (
    <div className="flex items-center justify-center h-full">
      <p className="font-mono text-sm text-white/20">No probes — compile a spec first</p>
    </div>
  );

  return (
    <div className="p-6 space-y-3 overflow-auto h-full">
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/25 mb-1">
          {probes.length} probes · attach with <code className="text-[#00D4FF]/60">forge probe --attach &lt;buId&gt; --url https://…</code>
        </p>
      </div>
      {probes.map((probe, i) => {
        const intent = intentMap.get(probe.intentId);
        const colors = METHOD_COLORS[probe.method] ?? METHOD_COLORS.GET;
        return (
          <motion.div
            key={probe.intentId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.035 }}
            className="bg-[#07070e] border border-white/[0.05] p-4 space-y-3"
          >
            <div className="flex items-center gap-3">
              <span
                className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-sm shrink-0"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                {probe.method}
              </span>
              <code className="font-mono text-[13px] text-white/80 flex-1 min-w-0 truncate">{probe.path}</code>
              <div className="flex items-center gap-1.5 shrink-0">
                {probe.expectedStatus.map((s) => (
                  <span key={s} className="font-mono text-[10px] text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded-sm">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4 text-[10px] font-mono">
              <span className="text-white/25">
                {probe.intentId} · {intent?.action}:{intent?.target}
              </span>
              {probe.expectedLatencyMs && (
                <span className="text-orange-400/60">&lt; {probe.expectedLatencyMs}ms</span>
              )}
              <div className="ml-auto flex items-center gap-1.5 text-white/20">
                <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                {probe.schedule}
              </div>
            </div>

            <p className="text-[11px] text-white/25 font-mono leading-relaxed">{probe.rationale}</p>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Main Playground ──────────────────────────────────────────────────────────

export default function Playground() {
  const [, setLocation] = useLocation();
  const [spec, setSpec] = useState(PLACEHOLDER);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [activeTab, setActiveTab] = useState<"graph" | "probes">("graph");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const compile = useCallback(async (text: string) => {
    if (text.trim().length < 10) {
      setResult(null);
      return;
    }
    setCompiling(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compile failed");
      setResult(null);
    } finally {
      setCompiling(false);
    }
  }, []);

  useEffect(() => {
    compile(spec);
  }, []);

  const handleChange = (text: string) => {
    setSpec(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => compile(text), 480);
  };

  const qualityColor =
    !result ? "text-white/20" :
    result.quality.overall >= 70 ? "text-[#00D4FF]" :
    result.quality.overall >= 40 ? "text-orange-400" : "text-red-400";

  const blockingAmbiguities = result?.ambiguities.filter((a) => a.severity === "blocking") ?? [];
  const warnings = result?.ambiguities.filter((a) => a.severity === "warning") ?? [];

  return (
    <div className="min-h-screen bg-[#080810] text-white font-sans flex flex-col">
      {/* Top bar */}
      <header className="border-b border-white/[0.05] bg-[#080810]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-full px-6 h-14 flex items-center gap-6">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-[#00D4FF] flex items-center justify-center">
              <span className="font-mono text-[#080810] font-black text-[9px]">F</span>
            </div>
            <span className="font-black text-sm text-white">Forge</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="font-mono text-[#00D4FF] text-sm">Playground</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <AnimatePresence mode="wait">
              {compiling ? (
                <motion.div
                  key="compiling"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-xs font-mono text-white/40"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse" />
                  compiling…
                </motion.div>
              ) : result ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-xs font-mono text-white/30"
                >
                  <Clock className="w-3 h-3" />
                  {result.compileTime}ms
                </motion.div>
              ) : null}
            </AnimatePresence>

            {result && (
              <div className={`text-sm font-black font-mono ${qualityColor}`}>
                {result.quality.overall}<span className="text-white/20 font-normal">/100</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main split */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>

        {/* LEFT — Editor */}
        <div className="lg:w-[380px] xl:w-[440px] shrink-0 flex flex-col border-r border-white/[0.05]">
          <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <span className="font-mono text-[11px] text-white/30 uppercase tracking-widest">Spec</span>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-[#00D4FF]" />
              <span className="font-mono text-[10px] text-white/30">Live</span>
            </div>
          </div>

          <textarea
            value={spec}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="flex-1 resize-none bg-transparent font-mono text-[13px] text-white/80 leading-[1.7] p-5 outline-none placeholder:text-white/15 border-0"
            style={{ minHeight: 200 }}
          />

          {/* Quality panel */}
          {result && (
            <div className="border-t border-white/[0.04] p-5 space-y-3 bg-[#050508]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">Quality</span>
                <span className={`font-mono text-sm font-black ${qualityColor}`}>
                  {result.quality.overall}/100
                </span>
              </div>
              <QualityBar label="Specific" value={result.quality.specificity} />
              <QualityBar label="Testable" value={result.quality.testability} />
              <QualityBar label="Scoped" value={result.quality.scopeClarity} />
              <QualityBar label="Actor" value={result.quality.actorDefinition} />
            </div>
          )}

          {/* Ambiguities */}
          {(blockingAmbiguities.length > 0 || warnings.length > 0) && (
            <div className="border-t border-white/[0.04] p-4 space-y-2 bg-[#050508]">
              {blockingAmbiguities.map((a, i) => (
                <div key={i} className="flex gap-2 text-[11px] font-mono text-red-400/80">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-red-400" />
                  <span className="leading-relaxed">{a.question}</span>
                </div>
              ))}
              {warnings.map((a, i) => (
                <div key={i} className="flex gap-2 text-[11px] font-mono text-orange-400/70">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-orange-400" />
                  <span className="leading-relaxed">{a.question}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — Graph */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-5 py-2.5 border-b border-white/[0.04] flex items-center justify-between shrink-0 gap-4">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("graph")}
                className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest rounded-sm transition-colors ${
                  activeTab === "graph"
                    ? "text-white bg-white/[0.07]"
                    : "text-white/30 hover:text-white/60"
                }`}
              >
                Intent Graph
              </button>
              <button
                onClick={() => setActiveTab("probes")}
                className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest rounded-sm transition-colors flex items-center gap-1.5 ${
                  activeTab === "probes"
                    ? "text-[#00D4FF] bg-[#00D4FF]/[0.07]"
                    : "text-white/30 hover:text-white/60"
                }`}
              >
                {result && result.probes.length > 0 && (
                  <span className={`w-1 h-1 rounded-full ${activeTab === "probes" ? "bg-[#00D4FF] animate-pulse" : "bg-white/20"}`} />
                )}
                Production Probes
                {result && result.stats.probeCount > 0 && (
                  <span className="text-[9px] text-white/20 font-normal normal-case">{result.stats.probeCount}</span>
                )}
              </button>
            </div>
            {result && (
              <div className="flex items-center gap-4 font-mono text-[10px] text-white/30 shrink-0">
                <span><span className="text-white/60">{result.stats.totalIntents}</span> intents</span>
                <span><span className="text-[#00D4FF]">~{result.stats.estimatedLines}</span> lines</span>
                <span><span className="text-green-400">{result.stats.estimatedTests}</span> tests</span>
                <span><span className="text-white/50">{result.stats.executionGroups}</span> groups</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto relative">
            <AnimatePresence mode="wait">
              {error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="text-center font-mono">
                    <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                    <p className="text-sm text-red-400/80">{error}</p>
                  </div>
                </motion.div>
              ) : !result ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <p className="font-mono text-sm text-white/15">
                    {compiling ? "Compiling spec…" : "Start typing to compile"}
                  </p>
                </motion.div>
              ) : activeTab === "probes" ? (
                <motion.div
                  key="probes"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0"
                >
                  <ProbesPanel probes={result.probes} intents={result.intents} />
                </motion.div>
              ) : result.intents.length === 0 ? (
                <motion.div
                  key="no-intents"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="text-center font-mono">
                    <CheckCircle className="w-8 h-8 text-white/20 mx-auto mb-3" />
                    <p className="text-sm text-white/30">No intents resolved — try a more specific spec</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="dag"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full p-6"
                >
                  <DAGView intents={result.intents} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Legend */}
          {result && result.intents.length > 0 && (
            <div className="border-t border-white/[0.04] px-6 py-3 flex items-center gap-6 shrink-0 bg-[#050508]">
              {(["db", "agent", "verification", "migration"] as const)
                .filter((t) => result.intents.some((i) => i.type === t))
                .map((type) => {
                  const colors = TYPE_COLORS[type];
                  const labels: Record<string, string> = {
                    db: "DB / Schema",
                    agent: "Agent",
                    verification: "Verification",
                    migration: "Migration",
                  };
                  return (
                    <div key={type} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.dot }} />
                      <span className="font-mono text-[10px] text-white/30 uppercase tracking-wider">
                        {labels[type]}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
