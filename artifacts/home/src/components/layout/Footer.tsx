import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.04] py-12">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 bg-[#00D4FF] flex items-center justify-center">
            <span className="font-mono text-[#080810] font-black text-[9px]">F</span>
          </div>
          <span className="font-black text-sm text-white/60">Forge</span>
        </div>

        <div className="flex items-center gap-6 text-[12px] font-mono text-white/25 tracking-wide">
          <span>MIT License</span>
          <span className="text-white/[0.08]">·</span>
          <span>TypeScript</span>
          <span className="text-white/[0.08]">·</span>
          <span>187 tests passing</span>
        </div>

        <a
          href="https://github.com/w1123581321345589/forge-replit"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[12px] font-mono text-white/25 hover:text-[#00D4FF] transition-colors"
        >
          <Github className="w-3.5 h-3.5" />
          w1123581321345589/forge-replit
        </a>
      </div>
    </footer>
  );
}
