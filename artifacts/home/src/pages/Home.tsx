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
  const inView = useInView(ref, { once: true, margin: "-80px" });
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
    <div ref={ref} className="bg-[#07070e] border border-white/[0.07] overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.05] bg-[#0a0a14]">
        <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-[11px] text-white/30 tracking-wide">forge — bash</span>
      </div>
      <div className="p-6 sm:p-8 lg:p-10 min-h-[480px]">
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
    <div className="min-h-screen bg-[#080810] text-white font-sans overflow-x-hidden">
      <Navbar />

      <main>
        {/* ─── HERO ─────────────────────────────────────── */}
        <section
          id="hero"
          className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-24 pb-32 overflow-hidden"
        >
          {/* Dot grid */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          {/* Bottom fade */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#080810] to-transparent" />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative z-10 mb-10 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.1] text-white/50 text-xs font-mono tracking-widest uppercase"
          >
            Open Source &nbsp;·&nbsp; MIT &nbsp;·&nbsp; TypeScript
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 text-[clamp(3.5rem,10vw,8rem)] font-black tracking-[-0.04em] leading-[1.0] mb-8 max-w-5xl"
          >
            One engineer.
            <br />
            <span className="text-[#00D4FF]">The output</span> of ten.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 text-lg sm:text-xl text-white/50 max-w-2xl leading-relaxed font-light mb-12"
          >
            Forge turns a plain-English spec into a verified, tested codebase — automatically.
            Intent parsing, agent orchestration, and built-in verification in a single TypeScript framework.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="relative z-10 flex flex-col sm:flex-row items-center gap-4"
          >
            <a
              href="https://github.com/w1123581321345589/forge-replit"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-[#00D4FF] text-[#080810] px-8 py-3.5 font-bold text-sm tracking-wide hover:bg-white transition-all duration-200 flex items-center gap-2"
            >
              View on GitHub
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </a>
            <a
              href="#quickstart"
              className="px-8 py-3.5 font-medium text-sm text-white/50 hover:text-white transition-colors border border-white/[0.08] hover:border-white/20"
            >
              Quick start
            </a>
          </motion.div>
        </section>

        {/* ─── TERMINAL ─────────────────────────────────── */}
        <section id="pipeline" className="max-w-5xl mx-auto px-6 pb-40 -mt-8">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <AnimatedTerminal />
          </motion.div>
        </section>

        {/* ─── STATS ────────────────────────────────────── */}
        <section className="border-y border-white/[0.04] bg-[#050508]">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/[0.04]"
          >
            {[
              { value: 341, suffix: "", label: "lines from spec to shipping" },
              { value: 4, suffix: " min", label: "average pipeline run" },
              { value: 187, suffix: "", label: "tests across 11 packages" },
              { value: 0, suffix: "", label: "production failures in CI" },
            ].map((stat, i) => (
              <motion.div variants={fadeUp} key={i} className="flex flex-col px-8 py-8 first:pl-0">
                <span className="text-4xl lg:text-5xl font-black text-[#00D4FF] tracking-tighter tabular-nums mb-1.5">
                  <CountUp to={stat.value} suffix={stat.suffix} />
                </span>
                <span className="text-xs text-white/40 tracking-wide font-mono uppercase leading-relaxed">
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

            <motion.div variants={fadeUp} className="space-y-3">
              {[
                { label: "Install", code: "npm install -g @forge/cli" },
                { label: "Scaffold", code: "forge init my-project" },
                { label: "Compile", code: "forge compile spec.md" },
                { label: "Ship", code: "forge run && forge verify" },
              ].map(({ label, code }) => (
                <div key={label} className="flex items-center gap-4 bg-[#07070e] border border-white/[0.06] px-5 py-3.5 group hover:border-white/[0.12] transition-colors">
                  <span className="font-mono text-[10px] text-white/25 uppercase tracking-widest w-14 shrink-0">
                    {label}
                  </span>
                  <code className="font-mono text-sm text-white/80 flex-1 select-all">{code}</code>
                  <CopyButton text={code} />
                </div>
              ))}
            </motion.div>
          </motion.div>
        </section>

        {/* ─── FROM IDEA TO PR ──────────────────────────── */}
        <section id="architecture" className="border-t border-white/[0.04] py-40 bg-[#050508]">
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              <motion.p variants={fadeUp} className="font-mono text-xs text-[#00D4FF] tracking-widest uppercase mb-6">
                Architecture
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-4xl lg:text-5xl font-black tracking-tighter mb-24 leading-tight max-w-xl">
                From idea<br />to verified PR.
              </motion.h2>

              <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-0">
                {/* Connector line desktop */}
                <div className="absolute top-[22px] left-0 right-0 h-px bg-white/[0.05] hidden lg:block" />

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
                    className="relative lg:pr-8 pt-12 lg:pt-0"
                  >
                    <div className="w-11 h-11 bg-[#050508] border border-white/[0.08] flex items-center justify-center font-mono text-[#00D4FF] text-sm font-bold mb-8 relative z-10">
                      {s.n}
                    </div>
                    <h3 className="text-base font-bold mb-3 text-white">{s.title}</h3>
                    <p className="text-sm text-white/40 leading-relaxed font-light">{s.body}</p>
                    {i < 4 && (
                      <div className="absolute right-0 top-[22px] w-px h-full bg-white/[0.04] hidden lg:block" />
                    )}
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
            className="border-l-2 border-[#00D4FF] pl-10 lg:pl-16"
          >
            <p className="text-2xl lg:text-4xl font-light italic leading-snug text-white/90 mb-10">
              "I compiled a 3-page auth spec. Four minutes later, Forge had written
              341 lines of production TypeScript, all tests green, ready to merge.
              I didn't touch the keyboard."
            </p>
            <div className="font-mono text-sm text-white/40 tracking-wide">
              — Will Rose, creator of Forge
            </div>
          </motion.div>
        </section>

        {/* ─── PACKAGES ─────────────────────────────────── */}
        <section id="packages" className="border-t border-white/[0.04] py-40 bg-[#050508]">
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
              <motion.p variants={fadeUp} className="text-white/40 text-lg font-light mb-20 max-w-xl leading-relaxed">
                Each package is a specialist. Together, they replace a workflow that used to take a team of five.
              </motion.p>

              <div className="border-t border-white/[0.06]">
                {[
                  { name: "@forge/spec-compiler", role: "Understands what you want to build", desc: "Parses plain-English specs into structured, executable intent graphs." },
                  { name: "@forge/intent-graph", role: "Plans before it codes", desc: "Resolves dependencies, orders tasks, maps the full execution DAG." },
                  { name: "@forge/agents", role: "Writes the code", desc: "ImplementerAgent and VerifierAgent orchestrated by AgentRunner and AgentScheduler." },
                  { name: "@forge/verification", role: "Ships only what works", desc: "Automated assertions, regression tests, CI gate. Nothing merges un-verified." },
                  { name: "@forge/events", role: "Nothing gets lost", desc: "Typed event bus: every agent action is observable, loggable, and replayable." },
                  { name: "@forge/db", role: "Remembers everything", desc: "Drizzle ORM + PostgreSQL. Schema-first, zero magic, zero runtime codegen." },
                  { name: "@forge/cli", role: "One command to rule them all", desc: "forge init · compile · run · verify. The entire pipeline from your terminal." },
                ].map((pkg, i) => (
                  <motion.div
                    variants={fadeUp}
                    key={pkg.name}
                    className="group grid grid-cols-1 lg:grid-cols-[240px_1fr_2fr] gap-4 lg:gap-10 py-6 border-b border-white/[0.04] items-baseline hover:bg-white/[0.015] -mx-6 px-6 transition-colors cursor-default"
                  >
                    <code className="font-mono text-[#00D4FF] text-sm shrink-0">
                      {pkg.name}
                    </code>
                    <span className="text-white font-semibold text-sm">{pkg.role}</span>
                    <span className="text-white/40 text-sm font-light leading-relaxed">{pkg.desc}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ─── FINAL CTA ────────────────────────────────── */}
        <section className="py-40 max-w-6xl mx-auto px-6 text-center">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="flex flex-col items-center"
          >
            <motion.h2 variants={fadeUp} className="text-4xl lg:text-6xl font-black tracking-tighter mb-6 leading-tight max-w-2xl">
              Start building with Forge today.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-white/40 text-lg font-light mb-12 max-w-lg leading-relaxed">
              Open source, MIT licensed, no setup fees, no accounts required.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center gap-4">
              <a
                href="https://github.com/w1123581321345589/forge-replit"
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-[#00D4FF] text-[#080810] px-8 py-3.5 font-bold text-sm tracking-wide hover:bg-white transition-all duration-200 flex items-center gap-2"
              >
                Star on GitHub
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <div className="flex items-center gap-3 bg-[#07070e] border border-white/[0.06] px-5 py-3.5">
                <code className="font-mono text-sm text-white/70">npm install -g @forge/cli</code>
                <CopyButton text="npm install -g @forge/cli" />
              </div>
            </motion.div>
          </motion.div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
