import { motion, useInView, useMotionValue, useSpring, animate } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ArrowRight, Copy, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TERMINAL_LINES = [
  { text: "$ forge init --name auth-service", type: "cmd", delay: 0 },
  { text: "", type: "blank", delay: 200 },
  { text: "✓ Initialized Forge project in ./auth-service", type: "success", delay: 400 },
  { text: "✓ Linked @forge/db, @forge/agents, @forge/verification", type: "success", delay: 650 },
  { text: "", type: "blank", delay: 850 },
  { text: "$ forge compile spec.md", type: "cmd", delay: 1050 },
  { text: "", type: "blank", delay: 1250 },
  { text: "✓ Spec compiled → 7 intents resolved", type: "success", delay: 1500 },
  { text: "  ├── create:users_table        [db]", type: "tree", delay: 1700 },
  { text: "  ├── implement:jwt_middleware   [agent]", type: "tree", delay: 1850 },
  { text: "  ├── implement:auth_routes      [agent]", type: "tree", delay: 2000 },
  { text: "  ├── implement:refresh_tokens   [agent]", type: "tree", delay: 2150 },
  { text: "  ├── test:auth_flow             [verification]", type: "tree", delay: 2300 },
  { text: "  ├── test:token_expiry          [verification]", type: "tree", delay: 2450 },
  { text: "  └── test:rate_limiting         [verification]", type: "tree", delay: 2600 },
  { text: "", type: "blank", delay: 2800 },
  { text: "$ forge run", type: "cmd", delay: 3000 },
  { text: "", type: "blank", delay: 3150 },
  { text: "  @forge/intent-graph   Resolving dependency graph...", type: "log", delay: 3350 },
  { text: "  @forge/agents         ImplementerAgent → users_table        ✓ 47 lines", type: "run", delay: 3700 },
  { text: "  @forge/agents         ImplementerAgent → jwt_middleware     ✓ 89 lines", type: "run", delay: 4100 },
  { text: "  @forge/agents         ImplementerAgent → auth_routes        ✓ 134 lines", type: "run", delay: 4500 },
  { text: "  @forge/agents         ImplementerAgent → refresh_tokens     ✓ 71 lines", type: "run", delay: 4900 },
  { text: "  @forge/verification   VerifierAgent    → auth_flow          ✓ 12/12 tests", type: "run", delay: 5300 },
  { text: "  @forge/verification   VerifierAgent    → token_expiry       ✓  8/8 tests", type: "run", delay: 5650 },
  { text: "  @forge/verification   VerifierAgent    → rate_limiting      ✓  6/6 tests", type: "run", delay: 6000 },
  { text: "", type: "blank", delay: 6300 },
  { text: "  341 lines of production code. 26 tests. 0 failures.", type: "result", delay: 6500 },
  { text: "  Time elapsed: 4m 12s", type: "muted", delay: 6700 },
];

function TerminalLine({ line }: { line: typeof TERMINAL_LINES[0] }) {
  if (line.type === "blank") return <div className="h-4" />;

  const isCmd = line.type === "cmd";
  const isSuccess = line.type === "success";
  const isTree = line.type === "tree";
  const isRun = line.type === "run";
  const isResult = line.type === "result";
  const isMuted = line.type === "muted";

  const renderTreeLine = (text: string) => {
    const prefixMatch = text.match(/^(\s+[├└]──\s+)(\w+):(\S+)(\s+)(\[\w+\])$/);
    if (prefixMatch) {
      return (
        <>
          <span className="text-white/30">{prefixMatch[1]}</span>
          <span className="text-[#00D4FF]">{prefixMatch[2]}:</span>
          <span className="text-white/80">{prefixMatch[3]}</span>
          <span>{prefixMatch[4]}</span>
          <span className="text-white/30">{prefixMatch[5]}</span>
        </>
      );
    }
    return <span className="text-white/60">{text}</span>;
  };

  const renderRunLine = (text: string) => {
    const parts = text.match(/^(\s+)(@forge\/[\w-]+)(\s+)([\w ]+→\s+[\w_]+)(\s+)(✓\s+.+)$/);
    if (parts) {
      return (
        <>
          <span>{parts[1]}</span>
          <span className="text-white/30">{parts[2]}</span>
          <span>{parts[3]}</span>
          <span className="text-white/50">{parts[4]}</span>
          <span>{parts[5]}</span>
          <span className="text-[#00D4FF]">{parts[6]}</span>
        </>
      );
    }
    return <span className="text-white/60">{text}</span>;
  };

  return (
    <div className="font-mono text-[12px] sm:text-[13px] leading-[1.8]">
      {isCmd && (
        <span>
          <span className="text-white/30 select-none">$ </span>
          <span className="text-white">{line.text.slice(2)}</span>
        </span>
      )}
      {isSuccess && (
        <span>
          <span className="text-[#00D4FF]">✓</span>
          <span className="text-white/70"> {line.text.slice(2)}</span>
        </span>
      )}
      {isTree && renderTreeLine(line.text)}
      {isRun && renderRunLine(line.text)}
      {isResult && <span className="text-white font-medium">{line.text}</span>}
      {isMuted && <span className="text-white/40">{line.text}</span>}
      {line.type === "log" && <span className="text-white/40 italic">{line.text}</span>}
    </div>
  );
}

function AnimatedTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px" });
  const [visibleCount, setVisibleCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!inView || started) return;
    setStarted(true);
    TERMINAL_LINES.forEach((line, i) => {
      setTimeout(() => setVisibleCount(i + 1), line.delay);
    });
  }, [inView, started]);

  return (
    <div ref={ref} className="bg-[#050510] overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)" }}
      >
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-md px-12 py-1">
            <span className="font-mono text-[11px] text-white/25 tracking-wide">forge compile spec.md</span>
          </div>
        </div>
      </div>
      <div className="p-6 sm:p-8 min-h-[400px]">
        {TERMINAL_LINES.slice(0, visibleCount).map((line, i) => (
          <TerminalLine key={i} line={line} />
        ))}
        {visibleCount < TERMINAL_LINES.length && (
          <span className="inline-block w-2 h-4 bg-[#00D4FF] animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { damping: 50, stiffness: 300 });
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!inView) return;
    const controls = animate(motionVal, to, { duration: 1.5, ease: "easeOut" });
    return controls.stop;
  }, [inView, to, motionVal]);

  useEffect(() => {
    return spring.on("change", (v) => {
      setDisplay(Math.round(v).toString());
    });
  }, [spring]);

  return <span ref={ref}>{display}{suffix}</span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="text-white/30 hover:text-[#00D4FF] transition-colors p-1"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-4 h-4 text-[#00D4FF]" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

const PROBE_LINES = [
  { text: "$ forge probe --attach auth_flow --url https://api.myapp.com", type: "cmd", delay: 0 },
  { text: "", type: "blank", delay: 180 },
  { text: "✓ 3 criteria → 3 probes inferred", type: "success", delay: 400 },
  { text: "  → GET   /api/auth/login          expects [200]", type: "probe", delay: 580 },
  { text: "  → POST  /api/auth/register       expects [201]", type: "probe", delay: 720 },
  { text: "  → GET   /api/auth/refresh        expects [200]", type: "probe", delay: 860 },
  { text: "✓ Schedule active: every 5 minutes", type: "success", delay: 1060 },
  { text: "", type: "blank", delay: 1200 },
  { text: "12:00  ✓ 3/3  all criteria passing", type: "pass", delay: 1500 },
  { text: "12:05  ✓ 3/3  all criteria passing", type: "pass", delay: 1900 },
  { text: "12:10  ✗ 2/3  POST /auth/register → 500", type: "fail", delay: 2400 },
  { text: "12:15  ✗ 2/3  POST /auth/register → 500", type: "fail", delay: 2800 },
  { text: "12:20  ✗ 2/3  POST /auth/register → 500", type: "fail", delay: 3200 },
  { text: "", type: "blank", delay: 3350 },
  { text: "! 3 consecutive failures — cascading to graph", type: "warn", delay: 3600 },
  { text: "  auth_flow          → needs_reverification", type: "cascade", delay: 3800 },
  { text: "  auth_routes        → needs_reverification", type: "cascade", delay: 3950 },
  { text: "  jwt_middleware     → needs_reverification", type: "cascade", delay: 4100 },
  { text: "", type: "blank", delay: 4250 },
  { text: "✓ CoS escalation → inbox", type: "success", delay: 4500 },
  { text: "  \"POST /auth/register returns 500 (expected 201)\"", type: "ask", delay: 4700 },
];

function ProbeLine({ line }: { line: typeof PROBE_LINES[0] }) {
  if (line.type === "blank") return <div className="h-3.5" />;
  const isCmd = line.type === "cmd";
  const isSuccess = line.type === "success";
  const isProbe = line.type === "probe";
  const isPass = line.type === "pass";
  const isFail = line.type === "fail";
  const isWarn = line.type === "warn";
  const isCascade = line.type === "cascade";
  const isAsk = line.type === "ask";
  return (
    <div className="font-mono text-[11px] sm:text-[12px] leading-[1.75]">
      {isCmd && <span><span className="text-white/25 select-none">$ </span><span className="text-white">{line.text.slice(2)}</span></span>}
      {isSuccess && <span><span className="text-[#00D4FF]">✓</span><span className="text-white/70"> {line.text.slice(2)}</span></span>}
      {isProbe && <span className="text-white/35">{line.text}</span>}
      {isPass && <span><span className="text-white/30">{line.text.slice(0, 6)}</span><span className="text-green-400">  ✓</span><span className="text-white/40"> {line.text.slice(9)}</span></span>}
      {isFail && <span><span className="text-white/30">{line.text.slice(0, 6)}</span><span className="text-red-400">  ✗</span><span className="text-red-400/70"> {line.text.slice(9)}</span></span>}
      {isWarn && <span className="text-orange-400 font-semibold">{line.text}</span>}
      {isCascade && <span><span className="text-white/30">{line.text.split("→")[0]}</span><span className="text-orange-400">→</span><span className="text-orange-400/70"> needs_reverification</span></span>}
      {isAsk && <span className="text-[#00D4FF]/60 italic">{line.text}</span>}
    </div>
  );
}

function ProbeTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [visibleCount, setVisibleCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!inView || started) return;
    setStarted(true);
    PROBE_LINES.forEach((line, i) => {
      setTimeout(() => setVisibleCount(i + 1), line.delay);
    });
  }, [inView, started]);

  return (
    <div ref={ref} className="relative">
      {/* Glow behind probe terminal */}
      <div
        className="absolute -inset-6 opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(0,212,255,0.08), transparent 70%)", filter: "blur(20px)" }}
      />
      <div
        className="relative bg-[#07070e] border border-white/[0.08] overflow-hidden rounded-xl"
        style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.05]" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent)" }}>
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
          <span className="ml-3 font-mono text-[11px] text-white/25 tracking-wide">forge probe — production monitor</span>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-mono text-[10px] text-green-400/50 tracking-widest uppercase">live</span>
          </div>
        </div>
        <div className="p-6 min-h-[380px]">
          {PROBE_LINES.slice(0, visibleCount).map((line, i) => (
            <ProbeLine key={i} line={line} />
          ))}
          {visibleCount < PROBE_LINES.length && (
            <span className="inline-block w-2 h-3.5 bg-[#00D4FF] animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}

function ProductionLoopSection() {
  return (
    <section className="border-t border-white/[0.04] py-40 relative overflow-hidden" style={{ background: "linear-gradient(180deg, #06060f 0%, #090916 50%, #06060f 100%)" }}>
      {/* Section orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/2 left-[-10%] -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(ellipse, #7C3AED, transparent 70%)", filter: "blur(80px)" }}
        />
        <div
          className="absolute top-1/2 right-[-5%] -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(ellipse, #00D4FF, transparent 70%)", filter: "blur(80px)" }}
        />
      </div>
      <div className="max-w-6xl mx-auto px-6 relative z-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-start"
        >
          {/* Left: copy */}
          <div>
            <motion.p variants={fadeUp} className="font-mono text-xs text-[#00D4FF] tracking-widest uppercase mb-6">
              @forge/probes
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-4xl lg:text-5xl font-black tracking-tighter mb-6 leading-tight">
              Deployment is the beginning of the next loop.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-white/45 text-base font-light leading-relaxed mb-14 max-w-lg">
              The moment a claim transitions to <code className="font-mono text-white/70 bg-white/[0.05] px-1.5 py-0.5 text-sm">deployed</code>, attach a probe. Your acceptance criteria become HTTP assertions running every five minutes against production. When reality diverges from the spec, the graph knows first.
            </motion.p>

            <motion.div variants={stagger} className="space-y-8">
              {[
                {
                  n: "01",
                  title: "Specs become probes — automatically",
                  body: "The acceptance criteria you wrote to specify the claim are translated into concrete HTTP assertions. No test code to write. No monitoring to configure.",
                  color: "text-[#00D4FF]",
                },
                {
                  n: "02",
                  title: "Three failures cascade the graph",
                  body: "At three consecutive failures, every dependent BU transitions to needs_reverification. The intent map turns red. You see exactly which claims are failing and why.",
                  color: "text-orange-400",
                },
                {
                  n: "03",
                  title: "One ask. Nothing else.",
                  body: "The chief-of-staff escalation contains the exact claim that failed and the exact ask. No noise. The claim-to-reality gap closes permanently.",
                  color: "text-green-400",
                },
              ].map((item) => (
                <motion.div
                  key={item.n}
                  variants={fadeUp}
                  className="flex gap-5 group"
                >
                  <span className={`font-mono text-xs ${item.color} opacity-50 shrink-0 mt-1 w-5`}>{item.n}</span>
                  <div>
                    <p className="font-semibold text-sm text-white mb-1.5">{item.title}</p>
                    <p className="text-white/40 text-sm font-light leading-relaxed">{item.body}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <motion.div variants={fadeUp} className="mt-14 pt-10 border-t border-white/[0.04]">
              <div className="flex items-center gap-3 bg-[#07070e] border border-white/[0.06] px-5 py-3.5 inline-flex w-auto">
                <code className="font-mono text-sm text-white/70">forge probe --attach &lt;buId&gt; --url https://api.yourapp.com</code>
              </div>
            </motion.div>
          </div>

          {/* Right: probe terminal */}
          <motion.div variants={fadeUp}>
            <ProbeTerminal />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-[#06060f] text-white font-sans overflow-x-hidden">
      {/* Noise texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-[999] opacity-[0.028]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px",
        }}
      />

      <Navbar />

      <main>
        {/* ─── HERO ─────────────────────────────────────── */}
        <section id="hero" className="relative overflow-hidden">
          {/* === Layered background === */}

          {/* 1. Mesh gradient — strong, visible */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: `
              radial-gradient(ellipse 80% 70% at 10% -10%, rgba(112, 56, 255, 0.22) 0%, transparent 55%),
              radial-gradient(ellipse 70% 60% at 90% 0%, rgba(0, 212, 255, 0.18) 0%, transparent 55%),
              radial-gradient(ellipse 50% 40% at 50% 110%, rgba(0, 190, 255, 0.07) 0%, transparent 60%)
            `
          }} />

          {/* 2. Grid lines */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px"
          }} />

          {/* 3. Center radial vignette (pops center content) */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse 100% 80% at 50% 0%, transparent 20%, rgba(6,6,15,0.7) 80%)"
          }} />

          {/* 4. Bottom fade into next section */}
          <div className="absolute bottom-0 left-0 right-0 h-80 pointer-events-none bg-gradient-to-t from-[#06060f] via-[#06060f]/60 to-transparent" />

          {/* === Content === */}
          <div className="relative z-10 max-w-6xl mx-auto px-6 pt-36 pb-0 flex flex-col items-center text-center">

            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-8 inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] text-white/45 text-[11px] font-mono tracking-[0.15em] uppercase backdrop-blur-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse shadow-[0_0_6px_rgba(0,212,255,0.8)]" />
              v0.1.0 · Open Source · MIT · TypeScript
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.07, ease: [0.16, 1, 0.3, 1] }}
              className="text-[clamp(3rem,8.5vw,7rem)] font-black tracking-[-0.045em] leading-[1.0] mb-6 max-w-5xl"
            >
              One engineer.
              <br />
              <span className="gradient-text">The output</span>
              {" "}of ten.
            </motion.h1>

            {/* Subtext */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="text-[1.1rem] text-white/40 max-w-[520px] leading-[1.75] font-light mb-10"
            >
              Write a spec in plain English. Forge compiles it into a verified,
              tested codebase — automatically. No scaffolding. No handholding.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center gap-3 mb-20"
            >
              <a
                href="https://github.com/w1123581321345589/forge-replit"
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-[#00D4FF] text-[#06060f] px-7 py-3 font-bold text-[14px] rounded-lg tracking-wide transition-all duration-300 flex items-center gap-2 glow-cyan glow-cyan-hover hover:bg-white"
              >
                View on GitHub
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
              </a>
              <a
                href="/playground"
                className="group px-7 py-3 font-medium text-[14px] text-white/50 hover:text-white transition-all duration-200 border border-white/[0.09] hover:border-white/20 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] flex items-center gap-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse" />
                Try Playground
              </a>
            </motion.div>

            {/* ─── PRODUCT VISUAL: Terminal floating in hero ─── */}
            <motion.div
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.0, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-4xl mb-0"
              id="pipeline"
            >
              {/* Ambient glow under terminal */}
              <div className="absolute -inset-x-20 -bottom-10 h-48 pointer-events-none" style={{
                background: "radial-gradient(ellipse at 50% 100%, rgba(0,212,255,0.09) 0%, transparent 65%)",
                filter: "blur(28px)"
              }} />

              {/* Terminal window frame */}
              <div
                className="relative rounded-2xl overflow-hidden border border-white/[0.1]"
                style={{
                  boxShadow: "0 80px 200px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
                  transform: "perspective(2000px) rotateX(4deg)",
                  transformOrigin: "top center",
                }}
              >
                <AnimatedTerminal />
              </div>
            </motion.div>
          </div>

          {/* Spacer so terminal overlaps into stats section naturally */}
          <div className="h-24" />
        </section>

        {/* ─── STATS ────────────────────────────────────── */}
        <section className="border-y border-white/[0.04]" style={{ background: "linear-gradient(180deg, #06060f 0%, #080814 50%, #06060f 100%)" }}>
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/[0.04]"
          >
            {[
              { value: 341, suffix: "", label: "Lines from spec to shipping" },
              { value: 4, suffix: " min", label: "Average pipeline runtime" },
              { value: 187, suffix: "", label: "Tests across 11 packages" },
              { value: 0, suffix: "", label: "Production failures in CI" },
            ].map((stat, i) => (
              <motion.div variants={fadeUp} key={i} className="flex flex-col px-8 py-10 first:pl-0 group">
                <span
                  className="text-4xl lg:text-[3.2rem] font-black tracking-tighter tabular-nums mb-2 transition-all duration-300"
                  style={{ background: "linear-gradient(135deg, #00D4FF 0%, #60c8ff 60%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
                >
                  <CountUp to={stat.value} suffix={stat.suffix} />
                </span>
                <span className="text-[11px] text-white/35 tracking-widest font-mono uppercase leading-relaxed">
                  {stat.label}
                </span>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* ─── QUICKSTART ───────────────────────────────── */}
        <section id="quickstart" className="py-40 max-w-6xl mx-auto px-6">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid lg:grid-cols-2 gap-20 items-center"
          >
            <div>
              <motion.p variants={fadeUp} className="font-mono text-xs text-[#00D4FF] tracking-widest uppercase mb-6">
                Get started
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-4xl lg:text-5xl font-black tracking-tighter mb-6 leading-tight">
                Up and running<br />in under a minute.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-white/50 text-lg font-light leading-relaxed">
                Install the CLI, scaffold a project, write a spec in plain English.
                Forge handles everything else — architecture, implementation, tests.
              </motion.p>
            </div>

            <motion.div variants={fadeUp} className="space-y-2">
              {[
                { label: "Install", code: "npm install -g @forge/cli", n: "01" },
                { label: "Scaffold", code: "forge init my-project", n: "02" },
                { label: "Compile", code: "forge compile spec.md", n: "03" },
                { label: "Ship", code: "forge run && forge verify", n: "04" },
              ].map(({ label, code, n }) => (
                <div
                  key={label}
                  className="flex items-center gap-4 bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.035] px-5 py-3.5 rounded-lg group transition-all duration-200"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
                >
                  <span className="font-mono text-[10px] text-white/20 uppercase tracking-widest w-6 shrink-0">{n}</span>
                  <span className="font-mono text-[10px] text-[#00D4FF]/50 uppercase tracking-widest w-14 shrink-0">{label}</span>
                  <code className="font-mono text-[13px] text-white/75 flex-1 select-all group-hover:text-white/90 transition-colors">{code}</code>
                  <CopyButton text={code} />
                </div>
              ))}
            </motion.div>
          </motion.div>
        </section>

        {/* ─── FROM IDEA TO PR ──────────────────────────── */}
        <section id="architecture" className="border-t border-white/[0.04] py-40" style={{ background: "linear-gradient(180deg, #06060f 0%, #08081a 50%, #06060f 100%)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              <motion.p variants={fadeUp} className="font-mono text-[11px] text-[#00D4FF]/70 tracking-[0.2em] uppercase mb-5">
                Architecture
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-4xl lg:text-5xl font-black tracking-[-0.04em] mb-24 leading-[1.1] max-w-xl">
                From idea<br />to verified PR.
              </motion.h2>

              <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-0">
                {/* Connector line desktop — gradient */}
                <div
                  className="absolute top-[21px] left-0 right-0 h-px hidden lg:block"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(0,212,255,0.15) 20%, rgba(0,212,255,0.15) 80%, transparent)" }}
                />

                {[
                  { n: "01", title: "Write a spec", body: "Plain English or YAML. Describe what to build, not how." },
                  { n: "02", title: "Compile", body: "Spec-compiler resolves intents, validates constraints, emits a type-safe graph." },
                  { n: "03", title: "Run agents", body: "Implementer and verifier agents execute in strict dependency order." },
                  { n: "04", title: "Verify", body: "Every output is asserted against the original spec before it merges." },
                  { n: "05", title: "Ship", body: "Clean PR. Full test coverage. Zero manual steps." },
                ].map((s, i) => (
                  <motion.div
                    variants={fadeUp}
                    key={s.n}
                    className="relative lg:pr-8 pt-12 lg:pt-0 group"
                  >
                    <div
                      className="w-[42px] h-[42px] flex items-center justify-center font-mono text-[#00D4FF] text-sm font-bold mb-8 relative z-10 rounded-md border border-[#00D4FF]/20 bg-[#00D4FF]/[0.04] group-hover:border-[#00D4FF]/40 group-hover:bg-[#00D4FF]/[0.08] transition-all duration-300"
                      style={{ boxShadow: "0 0 20px rgba(0,212,255,0.05)" }}
                    >
                      {s.n}
                    </div>
                    <h3 className="text-[15px] font-semibold mb-3 text-white/90 tracking-tight">{s.title}</h3>
                    <p className="text-sm text-white/35 leading-relaxed font-light">{s.body}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ─── QUOTE ────────────────────────────────────── */}
        <section className="py-40 max-w-5xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-2xl border border-white/[0.06] p-10 lg:p-16 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,255,0.03) 0%, rgba(124,58,237,0.02) 50%, transparent 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px rgba(0,0,0,0.3)"
            }}
          >
            {/* gradient accent left border */}
            <div className="absolute left-0 top-8 bottom-8 w-[2px] rounded-full" style={{ background: "linear-gradient(180deg, transparent, #00D4FF 30%, #818cf8 70%, transparent)" }} />
            {/* large quote mark */}
            <div className="absolute top-6 left-14 text-[120px] leading-none font-black text-[#00D4FF]/[0.06] select-none pointer-events-none">"</div>

            <p className="relative text-2xl lg:text-[2rem] font-light italic leading-[1.5] text-white/85 mb-10 max-w-3xl">
              "I compiled a 3-page auth spec. Four minutes later, Forge had written
              341 lines of production TypeScript, all tests green, ready to merge.
              I didn't touch the keyboard."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-6 h-px bg-[#00D4FF]/30" />
              <span className="font-mono text-sm text-white/35 tracking-wide">Will Rose — creator of Forge</span>
            </div>
          </motion.div>
        </section>

        {/* ─── PACKAGES ─────────────────────────────────── */}
        <section id="packages" className="border-t border-white/[0.04] py-40" style={{ background: "linear-gradient(180deg, #06060f 0%, #07071a 60%, #06060f 100%)" }}>
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              <motion.p variants={fadeUp} className="font-mono text-xs text-[#00D4FF] tracking-widest uppercase mb-6">
                Packages
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-4xl lg:text-5xl font-black tracking-tighter mb-4 leading-tight">
                Your virtual engineering team.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-white/40 text-lg font-light mb-12 max-w-xl leading-relaxed">
                Each package is a specialist. Together, they replace a workflow that used to take a team of five.
              </motion.p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { name: "@forge/spec-compiler", short: "spec-compiler", role: "Understands what you want to build", desc: "Parses plain-English specs into structured, executable intent graphs.", highlight: false },
                  { name: "@forge/intent-graph", short: "intent-graph", role: "Plans before it codes", desc: "Resolves dependencies, orders tasks, maps the full execution DAG.", highlight: false },
                  { name: "@forge/agents", short: "agents", role: "Writes the code", desc: "ImplementerAgent and VerifierAgent orchestrated by AgentRunner.", highlight: false },
                  { name: "@forge/verification", short: "verification", role: "Ships only what works", desc: "Automated assertions, regression tests, CI gate. Nothing merges un-verified.", highlight: false },
                  { name: "@forge/probes", short: "probes", role: "Keeps it working in production", desc: "Acceptance criteria → HTTP probes every 5 min. 3 failures cascade the graph.", highlight: true },
                  { name: "@forge/events", short: "events", role: "Nothing gets lost", desc: "Typed event bus: every agent action is observable, loggable, and replayable.", highlight: false },
                  { name: "@forge/db", short: "db", role: "Remembers everything", desc: "Drizzle ORM + PostgreSQL. Schema-first, zero magic, zero runtime codegen.", highlight: false },
                  { name: "@forge/cli", short: "cli", role: "One command to rule them all", desc: "forge init · compile · run · probe · verify. The entire pipeline.", highlight: false },
                ].map((pkg) => (
                  <motion.div
                    variants={fadeUp}
                    key={pkg.name}
                    className={`group relative rounded-xl p-5 border transition-all duration-300 cursor-default overflow-hidden ${
                      pkg.highlight
                        ? "border-[#00D4FF]/25 hover:border-[#00D4FF]/50"
                        : "border-white/[0.06] hover:border-white/[0.14]"
                    }`}
                    style={{
                      background: pkg.highlight
                        ? "linear-gradient(145deg, rgba(0,212,255,0.06) 0%, rgba(0,212,255,0.02) 100%)"
                        : "linear-gradient(145deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)"
                    }}
                  >
                    {/* Top right glow on highlight */}
                    {pkg.highlight && (
                      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-30 pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(0,212,255,0.4), transparent 70%)", filter: "blur(12px)" }} />
                    )}
                    <div className={`font-mono text-[11px] mb-3 tracking-tight flex items-center gap-2 ${pkg.highlight ? "text-[#00D4FF]" : "text-[#00D4FF]/55 group-hover:text-[#00D4FF]/80"} transition-colors`}>
                      <span>@forge/</span><span className="text-white/60 group-hover:text-white/90 transition-colors">{pkg.short}</span>
                      {pkg.highlight && <span className="text-[9px] border border-[#00D4FF]/30 px-1 py-0.5 rounded text-[#00D4FF]/60 tracking-widest uppercase">new</span>}
                    </div>
                    <div className="text-[13px] font-semibold text-white/85 mb-2 leading-snug group-hover:text-white transition-colors">{pkg.role}</div>
                    <div className="text-[12px] text-white/30 leading-relaxed group-hover:text-white/45 transition-colors">{pkg.desc}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ─── PRODUCTION LOOP ──────────────────────────── */}
        <ProductionLoopSection />

        {/* ─── FINAL CTA ────────────────────────────────── */}
        <section className="relative py-48 overflow-hidden border-t border-white/[0.04]">
          {/* CTA gradient background */}
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full opacity-[0.06]"
              style={{ background: "radial-gradient(ellipse, #00D4FF, transparent 65%)", filter: "blur(60px)" }}
            />
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-[0.04]"
              style={{ background: "radial-gradient(ellipse, #7C3AED, transparent 65%)", filter: "blur(80px)" }}
            />
          </div>
          {/* Dot grid */}
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="flex flex-col items-center"
            >
              <motion.div variants={fadeUp} className="mb-6 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] text-white/35 text-[11px] font-mono tracking-widest uppercase">
                Free & open source
              </motion.div>
              <motion.h2 variants={fadeUp} className="text-4xl lg:text-6xl font-black tracking-[-0.04em] mb-6 leading-[1.05] max-w-2xl">
                Start building with<br />Forge today.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-white/35 text-lg font-light mb-12 max-w-lg leading-relaxed">
                MIT licensed. No setup fees. No accounts. Clone, run, ship.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center gap-3">
                <a
                  href="https://github.com/w1123581321345589/forge-replit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative bg-[#00D4FF] text-[#06060f] px-8 py-3.5 font-bold text-sm rounded-md tracking-wide transition-all duration-300 flex items-center gap-2 glow-cyan glow-cyan-hover hover:bg-white"
                >
                  Star on GitHub
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
                </a>
                <div
                  className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.07] px-5 py-3.5 rounded-md backdrop-blur-sm hover:border-white/[0.12] transition-colors"
                  style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
                >
                  <code className="font-mono text-[13px] text-white/60">npm install -g @forge/cli</code>
                  <CopyButton text="npm install -g @forge/cli" />
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
