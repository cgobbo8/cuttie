import type { BrandColors, DetectedFacecam, LookedUpChannel } from "../../lib/api";

/** The channel typed on step 1, with its logo colors once detected */
export interface FoundChannel {
  channel: LookedUpChannel;
  colors: { palette: string[]; roles: BrandColors } | null;
}

/** Looking for the webcam on the latest live (starts as soon as the channel is saved) */
export type CamSearch =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; result: DetectedFacecam }
  | { status: "error"; message: string };

/** Three bars on top of the active card: done and current steps in the accent color */
export function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`flex-1 h-1 rounded-[2px] transition-colors duration-500 ${i <= step ? "bg-accent" : "bg-white/[0.14]"}`} />
      ))}
    </div>
  );
}
