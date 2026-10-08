import { brand, clamp01, num, type KitWidgetProps } from "./shared";

/** A thin bar filling up as the clip plays */
export default function ProgressBar({ props, width, height, currentTime = 0 }: KitWidgetProps) {
  const { accent } = brand(props);
  const start = num(props, "startAt", 0);
  const end = num(props, "endAt", start + 60);
  const progress = clamp01((currentTime - start) / Math.max(0.1, end - start));
  return (
    <div style={{ width, height, borderRadius: height / 2, background: "rgba(255,255,255,0.22)", overflow: "hidden" }}>
      <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: height / 2, background: accent, boxShadow: `0 0 ${height}px ${accent}` }} />
    </div>
  );
}
