import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptWord } from "../../lib/api";

interface Props {
  words: TranscriptWord[];
  currentTime: number;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Group words into sentences (split on punctuation or every ~10 words) */
function groupIntoSentences(words: TranscriptWord[]): { text: string; start: number; end: number }[] {
  if (words.length === 0) return [];

  const sentences: { text: string; start: number; end: number }[] = [];
  let current: TranscriptWord[] = [];

  for (const w of words) {
    current.push(w);
    const endsWithPunct = /[.!?…]$/.test(w.word.trim());
    if (endsWithPunct || current.length >= 10) {
      sentences.push({
        text: current.map((cw) => cw.word).join(" "),
        start: current[0].start,
        end: current[current.length - 1].end,
      });
      current = [];
    }
  }
  if (current.length > 0) {
    sentences.push({
      text: current.map((cw) => cw.word).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
    });
  }

  return sentences;
}

export default function TranscriptionPanel({ words, currentTime, onSeek }: Props) {
  const { t } = useTranslation();
  const sentences = groupIntoSentences(words);
  const activeRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active sentence
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      const container = containerRef.current;
      const el = activeRef.current;
      const elTop = el.offsetTop - container.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const scrollTop = container.scrollTop;
      const viewHeight = container.clientHeight;

      if (elTop < scrollTop || elBottom > scrollTop + viewHeight) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [currentTime]);

  if (words.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-[11px] text-zinc-600 text-center">{t("editor.noTranscriptionAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{t("editor.transcription")}</p>
        <p className="text-[10px] text-zinc-600 mt-0.5">{t("editor.sentenceCount", { count: sentences.length })}</p>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        <div className="py-1">
          {sentences.map((s, i) => {
            const isActive = currentTime >= s.start && currentTime < s.end;
            return (
              <button
                key={i}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSeek(s.start)}
                className={`w-full text-left px-3 py-2 transition-colors group ${
                  isActive
                    ? "bg-blue-500/[0.12] border-l-2 border-blue-400"
                    : "hover:bg-white/[0.04] border-l-2 border-transparent"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className={`text-[10px] font-mono tabular-nums shrink-0 mt-px ${
                    isActive ? "text-blue-400" : "text-zinc-500 group-hover:text-zinc-400"
                  }`}>
                    {formatTime(s.start)}
                  </span>
                  <span className={`text-[11px] leading-relaxed ${
                    isActive ? "text-blue-200" : "text-zinc-400"
                  }`}>
                    {s.text}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
