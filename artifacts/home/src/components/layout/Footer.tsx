import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.04] py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-5 h-5 flex items-center justify-center rounded-[4px]"
            style={{ background: "linear-gradient(135deg, #00D4FF, #38bdf8)" }}
          >
            <span className="font-mono text-[#06060f] font-black text-[8px]">F</span>
          </div>
          <span className="font-semibold text-sm text-white/40 tracking-tight">Forge</span>
        </div>

        <div className="flex items-center gap-5 text-[11px] font-mono text-white/20 tracking-wider">
          <span>MIT License</span>
          <span className="text-white/[0.06]">·</span>
          <span>TypeScript</span>
          <span className="text-white/[0.06]">·</span>
          <span>v0.1.0</span>
          <span className="text-white/[0.06]">·</span>
          <span>374 tests passing</span>
        </div>

        <a
          href="https://github.com/w1123581321345589/forge-replit"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[11px] font-mono text-white/20 hover:text-[#00D4FF]/70 transition-colors duration-200"
        >
          <Github className="w-3.5 h-3.5" />
          w1123581321345589/forge-replit
        </a>
      </div>
    </footer>
  );
}
