import { useTranslation } from "react-i18next";

/** What the last line of the list is worth: no live is called this */
const OTHER = "__other";

interface Props {
  /** The lives the video takes passages from, its own first */
  lives: { job: string; label: string }[];
  value: string;
  onChange: (job: string) => void;
  /** One more live asked for (the video then takes from it too); absent: none can be */
  onOther?: () => void;
  /** What is being chosen, for who cannot see it */
  label: string;
  /** Said before each live (« Chercher dans : … ») */
  prefix?: string;
  className?: string;
}

/**
 * The live a tool works in (searching its words, going through it), among those the video takes
 * passages from. Its last line asks for one more live: a video takes from another live the day
 * one is needed, from the tool that needs it. Nothing to choose (one live, and no other can be
 * added): nothing is shown.
 */
export default function LiveChoice({ lives, value, onChange, onOther, label, prefix, className = "" }: Props) {
  const { t } = useTranslation();
  if (lives.length <= 1 && !onOther) return null;
  return (
    <select
      value={value}
      aria-label={label}
      // (the last line is not a live: the list stays on the one it was on while another is picked)
      onChange={(e) => (e.target.value === OTHER ? onOther?.() : onChange(e.target.value))}
      className={`select-arrow h-9 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark] ${className}`}
    >
      {lives.map((live) => (
        <option key={live.job} value={live.job}>
          {prefix ? `${prefix} : ${live.label}` : live.label}
        </option>
      ))}
      {onOther && <option value={OTHER}>{t("compilation.lives.other")}</option>}
    </select>
  );
}
