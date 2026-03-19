import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { useState, useEffect } from "react";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#06060f]/85 backdrop-blur-2xl border-b border-white/[0.06]"
          : "bg-[#06060f]/40 backdrop-blur-md border-b border-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-[60px] flex items-center justify-between">
        <a href="#hero" className="flex items-center gap-2.5 group">
          <div
            className="w-7 h-7 flex items-center justify-center rounded-[5px] shadow-[0_0_16px_rgba(0,212,255,0.3)]"
            style={{ background: "linear-gradient(135deg, #00D4FF, #38bdf8)" }}
          >
            <span className="font-mono text-[#06060f] font-black text-[11px] tracking-tighter">F</span>
          </div>
          <span className="font-bold text-[15px] tracking-tight text-white">Forge</span>
        </a>

        <nav className="hidden md:flex items-center gap-1">
          {[
            { label: "Architecture", href: "#architecture" },
            { label: "Pipeline", href: "#pipeline" },
            { label: "Packages", href: "#packages" },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="px-3.5 py-2 text-[13px] font-medium text-white/40 hover:text-white/90 transition-colors rounded-md hover:bg-white/[0.04]"
            >
              {label}
            </a>
          ))}
          <a
            href="/playground"
            className="ml-1 px-3.5 py-2 text-[13px] font-medium text-[#00D4FF]/70 hover:text-[#00D4FF] transition-colors rounded-md hover:bg-[#00D4FF]/[0.06] flex items-center gap-2"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D4FF] opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00D4FF]" />
            </span>
            Playground
          </a>
        </nav>

        <a
          href="https://github.com/w1123581321345589/forge-replit"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 text-[13px] font-medium text-white/50 hover:text-white transition-all duration-200 border border-white/[0.07] hover:border-white/20 px-3.5 py-2 rounded-md hover:bg-white/[0.03]"
        >
          <Github className="w-3.5 h-3.5 group-hover:text-white transition-colors" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </motion.header>
  );
}
