import { useMemo } from "react";

const COLS = 5;
const ROWS = 7;

/**
 * The streamer's own lives tiled behind the glass, so the welcome cards always
 * have something to refract. Before we know the channel: soft accent light.
 */
export default function LiveWall({ images }: { images: string[] }) {
  const tiles = useMemo(
    () =>
      images.length === 0
        ? []
        : Array.from({ length: COLS * ROWS }, (_, i) => images[(i + Math.floor(i / COLS) * 2) % images.length]),
    [images],
  );

  return (
    <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none bg-ground">
      <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_30%_35%,var(--color-accent-soft),transparent_70%),radial-gradient(45%_40%_at_78%_70%,rgba(255,255,255,0.05),transparent_70%)]" />
      <div
        className={`absolute -inset-[18%] grid gap-3 content-start transition-opacity duration-1000 ease-out wall-drift ${tiles.length ? "opacity-100" : "opacity-0"}`}
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, filter: "blur(2px) saturate(1.25) brightness(0.62)" }}
      >
        {tiles.map((src, i) => (
          <img key={i} src={src} alt="" className="w-full aspect-video object-cover rounded-[12px]" />
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_65%_at_42%_48%,rgba(11,11,12,0.15)_0%,rgba(11,11,12,0.7)_70%,rgba(11,11,12,0.94)_100%)]" />
    </div>
  );
}
