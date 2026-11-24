import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { AssistantComposer } from "../../lib/AssistantContext";

/** How many passages at most: a few of the best, or every one there is */
const COUNTS = [3, 5, 10, 0] as const;

interface Props {
  composer: AssistantComposer;
  busy: boolean;
  /** The request, written out: sent as the streamer's own words */
  onSend: (text: string) => void;
  onClose: () => void;
}

/**
 * A request written with the panel's help instead of from a blank box: passages to add to the
 * video on screen. What to look for is the only thing typed; how many and in which part are
 * chosen. It becomes a plain sentence, sent like any other.
 */
export default function Composer({ composer, busy, onSend, onClose }: Props) {
  const { t } = useTranslation();
  const [what, setWhat] = useState("");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(0);
  // Where they go: the last part unless another is chosen
  const [part, setPart] = useState(composer.parts[composer.parts.length - 1] ?? "");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const asked = what.trim().replace(/[.…]+$/, "");
    if (!asked || busy) return;
    onSend(
      [
        t("assistant.compose.passages.say", { what: asked }),
        count > 0 ? t("assistant.compose.passages.sayCount", { count }) : "",
        composer.parts.length > 1 && part ? t("assistant.compose.passages.sayPart", { part }) : t("assistant.compose.passages.sayEnd"),
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  return (
    <form onSubmit={send} className="p-3 rounded-[14px] bg-white/[0.05] border border-accent-line flex flex-col gap-2.5 animate-fade-in">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-[13px] font-[620] text-white">{t("assistant.compose.passages.title")}</b>
        <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="w-6 h-6 -mr-1 grid place-items-center rounded-[7px] text-ink-3 hover:text-white hover:bg-white/[0.08]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <label className="flex items-center gap-2 h-10 pl-2.5 pr-2 rounded-[10px] bg-black/30 border border-white/10 focus-within:border-accent-line transition-colors">
        <span className="flex-none text-[13px] text-ink-3">{t("assistant.compose.passages.lead")}</span>
        <input
          ref={field}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          maxLength={300}
          placeholder={t("assistant.compose.passages.placeholder")}
          aria-label={t("assistant.compose.passages.title")}
          className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-white placeholder:text-ink-4"
        />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label={t("assistant.compose.passages.count")} className="seg flex-1 min-w-[190px]">
          {COUNTS.map((n) => (
            <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>
              {n === 0 ? t("assistant.compose.passages.all") : n}
            </button>
          ))}
        </div>
      </div>
      {composer.parts.length > 1 && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className="flex-none">{t("assistant.compose.passages.into")}</span>
          <select value={part} onChange={(e) => setPart(e.target.value)} className="select-arrow flex-1 min-w-0 h-8 px-2 rounded-[9px] bg-black/30 border border-white/10 text-[12.5px] text-white outline-none focus:border-accent-line">
            {composer.parts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={!what.trim() || busy} className="btn btn-primary btn-sm self-end">
        <Search className="w-3.5 h-3.5" /> {t("assistant.compose.passages.send")}
      </button>
    </form>
  );
}
