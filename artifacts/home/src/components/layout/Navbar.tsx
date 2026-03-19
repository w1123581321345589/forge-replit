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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#080810]/95 backdrop-blur-md border-b border-white/[0.05]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#hero" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 bg-[#00D4FF] flex items-center justify-center">
            <span className="font-mono text-[#080810] font-black text-xs">F</span>
          </div>
          <span className="font-black text-base tracking-tight text-white">Forge</span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {[
            { label: "Architecture", href: "#architecture" },
            { label: "Pipeline", href: "#pipeline" },
            { label: "Packages", href: "#packages" },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="text-[13px] font-medium text-white/45 hover:text-white transition-colors tracking-wide"
            >
              {label}
            </a>
          ))}
          <a
            href="/playground"
            className="text-[13px] font-medium text-[#00D4FF]/70 hover:text-[#00D4FF] transition-colors tracking-wide flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] inline-block animate-pulse" />
            Playground
          </a>
        </nav>

        <a
          href="https://github.com/w1123581321345589/forge-replit"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white transition-colors border border-white/[0.08] hover:border-white/20 px-4 py-2"
        >
          <Github className="w-4 h-4" />
          <span className="hidden sm:inline text-[13px]">GitHub</span>
        </a>
      </div>
    </motion.header>
  );
}
