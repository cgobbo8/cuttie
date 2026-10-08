import type { CSSProperties } from "react";
import type { BrandColors, FacecamRect, SubtitleStyle } from "../lib/api";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Style for an <img> of the whole frame so that `region` covers its box */
export function cropStyle(region: Rect, frame: { w: number; h: number }, boxAspect: number): CSSProperties {
  let { x, y, w, h } = region;
  if (w / h > boxAspect) {
    const nw = h * boxAspect;
    x += (w - nw) / 2;
    w = nw;
  } else {
    const nh = w / boxAspect;
    y += (h - nh) / 2;
    h = nh;
  }
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${(frame.w / w) * 100}%`,
    height: `${(frame.h / h) * 100}%`,
    left: `${(-x / w) * 100}%`,
    top: `${(-y / h) * 100}%`,
  };
}

/** The gameplay next to the webcam column (the whole frame when there is no webcam) */
export function gameRegion(cam: Rect | null, frame: { w: number; h: number }): Rect {
  if (!cam || cam.w > frame.w * 0.6) return { x: 0, y: 0, w: frame.w, h: frame.h };
  return cam.x + cam.w / 2 > frame.w / 2
    ? { x: 0, y: 0, w: cam.x, h: frame.h }
    : { x: cam.x + cam.w, y: 0, w: frame.w - cam.x - cam.w, h: frame.h };
}

interface Props {
  /** Still frame of a clip (16:9) */
  frameUrl: string | null;
  facecam: FacecamRect | false | null;
  colors: BrandColors;
  avatarUrl: string | null;
  login: string | null;
  /** Subtitle words, one array per line */
  lines: string[][];
  /** Word spoken right now: [line, word] */
  highlight?: [number, number];
  subtitleStyle: SubtitleStyle;
  showWidget: boolean;
  className?: string;
}

/**
 * Still preview of the "Signature" template (1080x1920): webcam on top,
 * gameplay in the middle, the clip blurred behind, channel widget and
 * subtitles in the streamer's colors. Sizes are in % / cqw of the 1080 frame.
 */
export default function SignaturePreview({
  frameUrl,
  facecam,
  colors,
  avatarUrl,
  login,
  lines,
  highlight,
  subtitleStyle,
  showWidget,
  className = "",
}: Props) {
  const frame = { w: facecam ? facecam.ref_w || 1920 : 1920, h: facecam ? facecam.ref_h || 1080 : 1080 };
  const cam = facecam || null;
  const game = gameRegion(cam, frame);

  return (
    <div className={`relative aspect-[9/16] overflow-hidden bg-black [container-type:inline-size] ${className}`}>
      {frameUrl && (
        <>
          <img
            src={frameUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover scale-[1.18]"
            style={{ filter: "blur(4cqw) brightness(0.55) saturate(1.25)" }}
          />
          {cam ? (
            <>
              <div
                className="absolute overflow-hidden"
                style={{
                  left: "22.2%",
                  top: "7.8%",
                  width: "55.6%",
                  height: "34.7%",
                  borderRadius: "4.1cqw",
                  boxShadow: "0 0 0 0.6cqw #fff, 0 2cqw 5cqw rgba(0,0,0,0.55)",
                }}
              >
                <img src={frameUrl} alt="" style={cropStyle(cam, frame, 600 / 666)} />
              </div>
              <div
                className="absolute overflow-hidden"
                style={{ left: "3.7%", top: "45.2%", width: "92.6%", height: "37%", borderRadius: "3.3cqw", boxShadow: "0 2cqw 5cqw rgba(0,0,0,0.5)" }}
              >
                <img src={frameUrl} alt="" style={cropStyle(game, frame, 1000 / 711)} />
              </div>
            </>
          ) : (
            <div className="absolute overflow-hidden" style={{ left: 0, top: "21.9%", width: "100%", height: "56.25%" }}>
              <img src={frameUrl} alt="" style={cropStyle(game, frame, 16 / 9)} />
            </div>
          )}
        </>
      )}

      {lines.length > 0 && (
        <div
          className="absolute text-center"
          style={{ left: "4%", right: "4%", top: cam ? "72.9%" : "70%", transform: "translateY(-50%)" }}
        >
          {subtitleStyle === "minimal" ? (
            <span
              className="inline-block font-bold text-white leading-tight"
              style={{ fontSize: "5.4cqw", padding: "1.2cqw 2.4cqw", borderRadius: "2cqw", background: "rgba(0,0,0,0.55)" }}
            >
              {lines.map((line) => line.join(" ")).join(" ")}
            </span>
          ) : (
            <div className="clip-text text-white" style={{ fontSize: "8.9cqw" }}>
              {lines.map((line, li) => (
                <div key={li}>
                  {line.map((word, wi) => (
                    <span
                      key={wi}
                      style={subtitleStyle === "karaoke" && highlight?.[0] === li && highlight?.[1] === wi ? { color: colors.highlight } : undefined}
                    >
                      {wi > 0 ? " " : ""}
                      {word}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showWidget && login && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-white rounded-full whitespace-nowrap"
          style={{ top: "85.4%", height: "8.9cqw", gap: "1.6cqw", padding: "0 3.2cqw 0 1.1cqw", boxShadow: "0 1.4cqw 3.6cqw rgba(0,0,0,0.45)" }}
        >
          <span className="rounded-full overflow-hidden flex-none" style={{ width: "6.7cqw", height: "6.7cqw", background: colors.light }}>
            {avatarUrl && <img src={avatarUrl} alt="" className="w-full h-full object-cover" />}
          </span>
          <span style={{ fontSize: "3.4cqw", color: "#60707c", fontWeight: 500 }}>
            twitch.tv/<span style={{ color: colors.dark, fontWeight: 800 }}>{login}</span>
          </span>
        </div>
      )}
    </div>
  );
}
