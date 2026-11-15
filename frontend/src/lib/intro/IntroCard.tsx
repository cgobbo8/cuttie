import type { ComponentType, CSSProperties, ReactNode } from "react";
import { backOut, between, easeIn, easeOut, introSpan, noise, titleLines, type IntroId } from "./intros";

export interface IntroColors {
  accent: string;
  highlight: string;
  dark: string;
  light: string;
}

export interface IntroCardProps {
  id: IntroId;
  /** Frames since the intro started */
  frame: number;
  fps: number;
  title: string;
  /** The channel's name and logo (no logo: its first letter) */
  name: string;
  logo: string | null;
  colors: IntroColors;
  /** Font family of the title */
  font: string;
  /** The channel's follow button, shown next to its name and pressed before the video starts: what it says before and after (none: no button) */
  follow?: [string, string] | null;
  /** The "hook" intro: its moment plays underneath (a video), so only what frames it is drawn; and the frames it holds the screen for (as long as that moment) */
  over?: boolean;
  hold?: number;
  /** What draws the logo: Remotion's <Img> in a video (frames wait for it), a plain <img> elsewhere */
  Img?: ComponentType<{ src: string; style?: CSSProperties }>;
}

/** An intro is always drawn in this box: whoever shows it scales the box to its own size */
export const INTRO_W = 1080;
export const INTRO_H = 1920;

const Plain = ({ src, style }: { src: string; style?: CSSProperties }) => <img src={src} alt="" style={style} />;
const FILL: CSSProperties = { position: "absolute", inset: 0 };
/** Between what the apps cover: their tabs at the top, the caption and buttons at the bottom and on the right */
const SAFE: CSSProperties = { ...FILL, padding: "300px 110px 560px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" };

/** Black or white, whichever reads on this colour */
function inkOn(color: string): string {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n) || full.length < 6) return "#ffffff";
  const light = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return light > 0.58 ? "#0b0b0c" : "#ffffff";
}

interface Drawn extends Required<Omit<IntroCardProps, "id" | "frame" | "fps" | "Img" | "follow" | "hold">> {
  follow: [string, string] | null;
  /** Frames at 30 a second, whatever the video's own rate */
  f: number;
  hold: number;
  /** 0 while the intro holds the screen, up to 1 as it leaves */
  leave: number;
  lines: string[];
  size: number;
  logoBox: (size: number, style?: CSSProperties, square?: boolean) => ReactNode;
}

/** The title, line by line */
function Title({ d, color, line }: { d: Drawn; color: string; line: (i: number) => CSSProperties }) {
  return (
    <div style={{ fontFamily: d.font, fontSize: d.size, lineHeight: 1.06, color, letterSpacing: "0.01em" }}>
      {d.lines.map((text, i) => (
        <div key={i} style={{ whiteSpace: "nowrap", ...line(i) }}>
          {text}
        </div>
      ))}
    </div>
  );
}

const GEIST = '"Geist Variable", "Geist", system-ui, sans-serif';
const INK = "#0b0b0c";
const HEART = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
/** Frames before the video starts at which the follow button is pressed */
const PRESS = 12;

/**
 * The channel's signature under the title: its name and, next to it, the follow button of its
 * widget. The button is pressed a moment before the video starts: it gives in, a ring bursts
 * from it, and it says the viewer now follows. `tone`: what it is painted with before that, so
 * it stands out on each intro's own background; `tag`: a label painted behind the name.
 */
function Signature({ d, color, tone = "accent", tag, style }: { d: Drawn; color: string; tone?: "accent" | "ink" | "white"; tag?: CSSProperties; style?: CSSProperties }) {
  const press = d.hold - PRESS;
  const done = d.f >= press;
  const give = done && d.f < press + 8 ? 1 - 0.16 * Math.sin(between(d.f, press, press + 8) * Math.PI) : 1;
  const burst = between(d.f, press, press + 12);
  const paint = { accent: [d.colors.accent, inkOn(d.colors.accent)], ink: [INK, "#ffffff"], white: ["#ffffff", INK] }[tone];
  const [fill, ink] = done ? [d.colors.highlight, inkOn(d.colors.highlight)] : paint;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, ...style }}>
      <div style={{ fontFamily: GEIST, fontWeight: 650, fontSize: 48, letterSpacing: "0.08em", textTransform: "uppercase", color, ...tag }}>{d.name}</div>
      {d.follow && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: "15px 32px 15px 24px", borderRadius: 16, background: fill, color: ink, fontFamily: GEIST, fontWeight: 700, fontSize: 46, lineHeight: 1, whiteSpace: "nowrap", boxShadow: "0 9px 0 rgba(0,0,0,0.3)", transform: `scale(${give})` }}>
          <svg width={44} height={44} viewBox="0 0 24 24" fill="currentColor" style={{ flex: "none" }}>
            <path d={HEART} />
          </svg>
          {d.follow[done ? 1 : 0]}
          <div style={{ position: "absolute", inset: -7, borderRadius: 20, border: `7px solid ${d.colors.highlight}`, opacity: done ? 1 - burst : 0, transform: `scale(${1 + 0.4 * easeOut(burst)})` }} />
        </div>
      )}
    </div>
  );
}

/** The logo falls on the screen, which shakes; the title punches in under it */
function Slam(d: Drawn) {
  const drop = backOut(between(d.f, 0, 11), 2.4);
  const wave = between(d.f, 8, 26);
  const shake = d.f >= 8 && d.f < 18 ? (1 - between(d.f, 8, 18)) * 22 : 0;
  const out = easeIn(d.leave);
  return (
    <div style={{ ...FILL, opacity: 1 - d.leave, transform: `scale(${1 + 0.7 * out})` }}>
      <div style={{ ...FILL, background: d.colors.dark }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 42%, ${d.colors.accent}, transparent 62%)`, opacity: d.f < 8 ? 0.12 : 0.22 + 0.5 * (1 - wave) }} />
      <div style={{ ...SAFE, transform: `translate(${shake * (noise(d.f * 3.1) - 0.5) * 2}px, ${shake * (noise(d.f * 7.7) - 0.5) * 2}px)` }}>
        <div style={{ position: "relative", marginBottom: 70 }}>
          <div
            style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `14px solid ${d.colors.accent}`, opacity: d.f < 8 ? 0 : 1 - wave, transform: `scale(${1 + 2.4 * easeOut(wave)})` }}
          />
          {d.logoBox(340, { transform: `scale(${2.8 - 1.8 * drop})`, opacity: between(d.f, 0, 4) })}
        </div>
        <Title
          d={d}
          color={inkOn(d.colors.dark)}
          line={(i) => ({ opacity: between(d.f, 13 + i * 3, 17 + i * 3), transform: `scale(${0.5 + 0.5 * backOut(between(d.f, 13 + i * 3, 25 + i * 3))})` })}
        />
        <Signature d={d} color={inkOn(d.colors.dark)} style={{ marginTop: 50, opacity: between(d.f, 22, 30), transform: `translateY(${(1 - easeOut(between(d.f, 22, 32))) * 40}px)` }} />
      </div>
    </div>
  );
}

/** Three slanted bands of the channel's colours cross the screen; the logo rolls in, the title rides a ribbon */
function Bands(d: Drawn) {
  const bands = [d.colors.accent, d.colors.highlight, d.colors.dark];
  // Each band comes in from the left, and leaves to the right in the other order: the video shows through as they go
  const x = (i: number) => {
    const leaving = easeIn(between(d.f, d.hold + (2 - i) * 2, d.hold + (2 - i) * 2 + 8));
    return -135 * (1 - easeOut(between(d.f, i * 3, i * 3 + 14))) + 135 * leaving;
  };
  // The logo and the title arrive once the last band is there, and leave with it
  const roll = backOut(between(d.f, 15, 31), 1.4);
  const ribbon = easeOut(between(d.f, 21, 35));
  return (
    <div style={FILL}>
      {bands.map((color, i) => (
        <div key={i} style={{ position: "absolute", inset: "-10% -30%", background: color, transform: `translateX(${x(i)}%) skewX(-12deg)` }} />
      ))}
      <div style={{ ...SAFE, transform: `translateX(${d.leave > 0 ? x(2) : 0}%)` }}>
        {d.logoBox(300, { marginBottom: 80, opacity: between(d.f, 14, 15), transform: `translateX(${(1 - roll) * -760}px) rotate(${(1 - roll) * -220}deg)` })}
        <div
          style={{ background: d.colors.accent, padding: "34px 54px 28px", opacity: between(d.f, 20, 21), transform: `translateX(${(1 - ribbon) * 1150}px) rotate(-3deg)`, boxShadow: `18px 18px 0 ${d.colors.highlight}` }}
        >
          <Title d={d} color={inkOn(d.colors.accent)} line={() => ({})} />
        </div>
        <Signature d={d} color={inkOn(d.colors.dark)} style={{ marginTop: 74, opacity: between(d.f, 30, 36), transform: `scale(${backOut(between(d.f, 30, 40))})` }} />
      </div>
    </div>
  );
}

/** A screen that misbehaves: the title splits into the channel's two colours, flickers, then holds */
function Glitch(d: Drawn) {
  const step = Math.floor(d.f / 2);
  // How far the two coloured copies sit from the title: wide at first, a twitch now and then, wide again as it leaves
  const split = 30 * (1 - between(d.f, 0, 16)) + (noise(step * 5.3) > 0.86 ? 16 : 0) + 60 * d.leave;
  // It catches in a few flickers, and goes out the same way
  const lit = d.f < 10 ? [0, 1, 1, 0, 1, 1, 1, 0, 1, 1][Math.floor(d.f)] === 1 : d.leave === 0 || [1, 1, 0, 1, 0, 0][Math.min(5, Math.floor(d.f - d.hold))] === 1;
  const slice = d.f < 12 || d.leave > 0 ? `inset(${noise(step * 2.9) * 55}% 0 ${noise(step * 4.1) * 30}% 0)` : undefined;
  const copy = (color: string, dx: number): CSSProperties => ({ ...FILL, color, transform: `translateX(${dx}px)`, mixBlendMode: "screen" });
  return (
    <div style={{ ...FILL, opacity: lit ? 1 : 0 }}>
      <div style={{ ...FILL, background: "#08090b", opacity: 1 - d.leave }} />
      <div style={{ ...FILL, backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 3px, transparent 3px 9px)", opacity: 1 - d.leave }} />
      {[0, 1, 2, 3, 4].map((i) =>
        (d.f < 18 || d.leave > 0) && noise(step * 3.7 + i * 11) > 0.55 ? (
          <div
            key={i}
            style={{ position: "absolute", left: `${noise(step + i * 7) * 80}%`, top: `${noise(step * 1.3 + i * 5) * 92}%`, width: `${14 + noise(step + i) * 40}%`, height: 26 + noise(i + step) * 60, background: i % 2 ? d.colors.accent : d.colors.highlight }}
          />
        ) : null,
      )}
      <div style={{ ...SAFE, clipPath: slice, transform: `translateX(${d.leave > 0 ? (noise(d.f * 2.3) - 0.5) * 160 : 0}px)` }}>
        {d.logoBox(280, { marginBottom: 84, boxShadow: `${12 + split * 0.4}px 12px 0 ${d.colors.accent}, ${-12 - split * 0.4}px -12px 0 ${d.colors.highlight}` }, true)}
        <div style={{ position: "relative" }}>
          <Title d={d} color="#ffffff" line={() => ({})} />
          <div style={copy(d.colors.accent, split)}>
            <Title d={d} color={d.colors.accent} line={() => ({})} />
          </div>
          <div style={copy(d.colors.highlight, -split)}>
            <Title d={d} color={d.colors.highlight} line={() => ({})} />
          </div>
        </div>
        <Signature d={d} color="#ffffff" style={{ marginTop: 60 }} />
      </div>
    </div>
  );
}

/** A ring of light draws itself around the logo, flickers like a tube that warms up; the title gathers under it */
function Neon(d: Drawn) {
  const round = 2 * Math.PI * 205;
  const drawn = easeOut(between(d.f, 0, 24));
  // A neon tube catching: on, off, on
  const tube = d.f < 24 ? 1 : d.f < 32 ? [1, 0.25, 1, 1, 0.4, 1, 0.7, 1][d.f - 24] : 1;
  const gather = easeOut(between(d.f, 20, 40));
  const line = easeOut(between(d.f, 30, 46));
  return (
    <div style={{ ...FILL, opacity: 1 - easeIn(d.leave), filter: d.leave > 0 ? `brightness(${1 + 1.6 * d.leave})` : undefined }}>
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 40%, ${d.colors.dark}, #050608 72%)` }} />
      <div style={SAFE}>
        <div style={{ position: "relative", width: 440, height: 440, marginBottom: 76, display: "grid", placeItems: "center" }}>
          <svg width={440} height={440} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", opacity: tube, filter: `drop-shadow(0 0 26px ${d.colors.accent})` }}>
            <circle cx={220} cy={220} r={205} fill="none" stroke={d.colors.accent} strokeWidth={12} strokeLinecap="round" strokeDasharray={round} strokeDashoffset={round * (1 - drawn)} />
          </svg>
          {d.logoBox(340, { opacity: between(d.f, 8, 22), transform: `scale(${0.7 + 0.3 * easeOut(between(d.f, 8, 24))})` })}
        </div>
        <Title d={d} color="#ffffff" line={() => ({ opacity: gather, letterSpacing: `${0.02 + 0.2 * (1 - gather)}em`, transform: `scale(${0.8 + 0.2 * gather})`, textShadow: `0 0 34px ${d.colors.accent}` })} />
        <div style={{ marginTop: 44, height: 8, width: 460 * line, borderRadius: 4, background: d.colors.highlight, boxShadow: `0 0 26px ${d.colors.highlight}` }} />
        <Signature d={d} color="#ffffff" style={{ marginTop: 46, opacity: between(d.f, 34, 44) }} />
      </div>
    </div>
  );
}

/** Speed lines burst from the edges like a manga panel; the logo rushes in from far away, the title slams down askew */
function Rush(d: Drawn) {
  const burst = easeOut(between(d.f, 0, 8));
  const come = backOut(between(d.f, 2, 15), 1.6);
  const slam = backOut(between(d.f, 10, 21), 2.2);
  const shake = d.f >= 12 && d.f < 20 ? (1 - between(d.f, 12, 20)) * 18 : 0;
  const out = easeIn(d.leave);
  // The lines are drawn again every other frame, a little turned: they flicker as if inked by hand
  const turn = Math.floor(d.f / 2) * 7;
  const fade = "radial-gradient(circle at 50% 45%, transparent 24%, #000 60%)";
  return (
    <div style={{ ...FILL, opacity: 1 - out }}>
      <div style={{ ...FILL, background: d.colors.accent }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 42%, ${d.colors.light}, transparent 48%)`, opacity: 0.6 }} />
      <div
        style={{
          position: "absolute",
          inset: "-40%",
          background: `repeating-conic-gradient(from ${turn}deg at 50% 45%, ${INK} 0deg 0.9deg, transparent 0.9deg 5deg)`,
          maskImage: fade,
          WebkitMaskImage: fade,
          opacity: burst,
          transform: `scale(${1.5 - 0.5 * burst + 2 * out})`,
        }}
      />
      <div style={{ ...SAFE, transform: `translate(${shake * (noise(d.f * 3.1) - 0.5) * 2}px, ${shake * (noise(d.f * 7.7) - 0.5) * 2}px)` }}>
        {d.logoBox(330, { marginBottom: 64, opacity: between(d.f, 2, 5), transform: `scale(${0.12 + 0.88 * come})`, boxShadow: `0 0 0 14px ${INK}, 0 0 0 28px #ffffff` })}
        <div style={{ opacity: between(d.f, 10, 12), transform: `rotate(-6deg) scale(${2.2 - 1.2 * slam})` }}>
          <Title d={d} color="#ffffff" line={() => ({ WebkitTextStroke: `${Math.round(d.size * 0.1)}px ${INK}`, paintOrder: "stroke fill", textShadow: `10px 12px 0 ${d.colors.highlight}` })} />
        </div>
        <Signature d={d} color={INK} tone="ink" tag={{ padding: "10px 30px 8px", background: "#ffffff" }} style={{ marginTop: 56, opacity: between(d.f, 20, 24), transform: `rotate(-6deg) scale(${backOut(between(d.f, 20, 30))})` }} />
      </div>
    </div>
  );
}

/** What stands for the video where nothing plays under a hook (the picker's sketch): a dark picture, light sliding across it */
function Footage({ d }: { d: Drawn }) {
  return (
    <>
      <div style={{ ...FILL, background: d.colors.dark }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 46%, ${d.colors.accent}, transparent 64%)`, opacity: 0.4 }} />
      <div style={{ position: "absolute", inset: -300, background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.07) 0 70px, transparent 70px 190px)", transform: `translateX(${(d.f * 5) % 190}px)` }} />
    </>
  );
}

/** The frame's edge as a fuse: a line a little inside the picture, going clockwise from the middle of the top */
const FUSE_INSET = 24;
const FUSE_W = INTRO_W - 2 * FUSE_INSET;
const FUSE_H = INTRO_H - 2 * FUSE_INSET;
const FUSE_LENGTH = 2 * (FUSE_W + FUSE_H);
const FUSE_PATH = `M ${INTRO_W / 2} ${FUSE_INSET} H ${INTRO_W - FUSE_INSET} V ${INTRO_H - FUSE_INSET} H ${FUSE_INSET} V ${FUSE_INSET} H ${INTRO_W / 2}`;

/** Where the fuse has burnt to, `at` pixels along it */
function alongFuse(at: number): { x: number; y: number } {
  const legs: [length: number, x: number, y: number, dx: number, dy: number][] = [
    [FUSE_W / 2, INTRO_W / 2, FUSE_INSET, 1, 0],
    [FUSE_H, INTRO_W - FUSE_INSET, FUSE_INSET, 0, 1],
    [FUSE_W, INTRO_W - FUSE_INSET, INTRO_H - FUSE_INSET, -1, 0],
    [FUSE_H, FUSE_INSET, INTRO_H - FUSE_INSET, 0, -1],
    [FUSE_W / 2, FUSE_INSET, FUSE_INSET, 1, 0],
  ];
  let left = Math.max(0, at);
  for (const [length, x, y, dx, dy] of legs) {
    if (left <= length) return { x: x + dx * left, y: y + dy * left };
    left -= length;
  }
  return { x: INTRO_W / 2, y: FUSE_INSET };
}

/** The streaks of a tape running back: where each one is across the picture, how thick, how long, and what it is painted with */
const STREAKS = Array.from({ length: 9 }, (_, i) => ({ y: noise(i * 7.31 + 1) * 0.92 + 0.03, thick: 12 + noise(i * 3.17 + 2) * 64, long: 520 + noise(i * 5.03 + 3) * 700, late: noise(i * 9.7 + 4) * 3, tone: i % 3 }));

/**
 * The best moment of the video plays first, under its title, and the intro only frames it. A fuse runs round
 * the picture and burns away as the moment plays: when it is gone the video starts. The channel is slapped on
 * a corner as a sticker (its logo, its name, its follow button). On the last frames the tape runs back (streaks
 * tear across, a rewind sign pops) and a white flash cuts to the start of the video: the moment was a look
 * ahead, the video now begins. In a video the moment and its title play underneath (`over`); alone, as in the
 * picker, it draws what stands for them.
 */
function Hook(d: Drawn) {
  // The fuse is whole on the first picture (the video's cover), then burns until a moment before the cut
  const burnt = between(d.f, 5, d.hold - 6) * FUSE_LENGTH;
  const spark = alongFuse(burnt);
  const lit = d.f >= 5 && d.f < d.hold - 6;
  const slap = backOut(between(d.f, 0, 11), 2.6);
  // The tape runs back over the last frames of the moment, and the first of the video
  const back = between(d.f, d.hold - 9, d.hold);
  const flash = d.f < d.hold ? easeIn(back) : 1 - easeOut(d.leave);
  const paint = [d.colors.highlight, "#ffffff", d.colors.accent];
  return (
    <div style={FILL}>
      {!d.over && (
        <>
          <Footage d={d} />
          <div style={{ ...SAFE, opacity: 1 - d.leave }}>
            {d.lines.map((text, i) => (
              <div
                key={i}
                style={{
                  fontFamily: d.font,
                  fontSize: Math.round(d.size * 0.8),
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  color: inkOn(d.colors.highlight),
                  background: d.colors.highlight,
                  padding: "18px 38px 12px",
                  marginTop: i ? -6 : 0,
                  boxShadow: `10px 12px 0 ${INK}`,
                  transform: `rotate(${i % 2 ? 2 : -4}deg) scale(${backOut(between(d.f, 5 + i * 4, 16 + i * 4), 2.2)})`,
                }}
              >
                {text}
              </div>
            ))}
          </div>
        </>
      )}
      {/* The fuse: inked, in the channel's colour, burning away from where it started */}
      <svg viewBox={`0 0 ${INTRO_W} ${INTRO_H}`} style={{ ...FILL, width: "100%", height: "100%", overflow: "visible", opacity: 1 - d.leave }}>
        <path d={FUSE_PATH} fill="none" stroke={INK} strokeWidth={36} strokeLinejoin="round" strokeDasharray={`0 ${burnt} ${FUSE_LENGTH} ${FUSE_LENGTH}`} />
        <path d={FUSE_PATH} fill="none" stroke={d.colors.highlight} strokeWidth={20} strokeLinejoin="round" strokeDasharray={`0 ${burnt} ${FUSE_LENGTH} ${FUSE_LENGTH}`} />
      </svg>
      {/* Its spark, and what flies off it */}
      {lit && (
        <div style={{ position: "absolute", left: spark.x, top: spark.y }}>
          <div
            style={{ position: "absolute", left: -90, top: -90, width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle, #ffffff 0 12%, ${d.colors.highlight} 26%, transparent 66%)`, transform: `scale(${0.75 + 0.5 * noise(d.f * 1.7)})` }}
          />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const angle = noise(Math.floor(d.f) * 3.3 + i * 11) * 2 * Math.PI;
            const far = 40 + noise(Math.floor(d.f) * 5.1 + i * 17) * 130;
            const size = 8 + noise(i * 2.9 + Math.floor(d.f)) * 14;
            return <div key={i} style={{ position: "absolute", left: Math.cos(angle) * far - size / 2, top: Math.sin(angle) * far - size / 2, width: size, height: size, background: i % 2 ? "#ffffff" : d.colors.highlight, transform: "rotate(45deg)" }} />;
          })}
        </div>
      )}
      {/* The channel, slapped on a corner */}
      <div style={{ position: "absolute", left: 70, top: 78, display: "flex", alignItems: "center", gap: 24, transformOrigin: "60px 60px", transform: `rotate(-4deg) scale(${1.3 - 0.3 * slap})`, opacity: 1 - d.leave }}>
        {d.logoBox(120, { boxShadow: `0 0 0 8px #ffffff, 9px 11px 0 8px ${INK}` })}
        <Signature d={d} color="#ffffff" tone="white" tag={{ padding: "10px 26px 8px", background: INK }} />
      </div>
      {/* The tape runs back: streaks tear across from the right, a rewind sign pops in the middle */}
      {back > 0 && d.leave < 1 && (
        <>
          {STREAKS.map((streak, i) => {
            const run = between(d.f, d.hold - 9 + streak.late, d.hold + 7);
            return <div key={i} style={{ position: "absolute", top: streak.y * INTRO_H, left: INTRO_W - run * (INTRO_W + streak.long + 300), width: streak.long, height: streak.thick, background: paint[streak.tone], boxShadow: `0 6px 0 ${INK}`, opacity: 0.92 }} />;
          })}
          <svg viewBox="-260 -160 520 320" style={{ position: "absolute", left: INTRO_W / 2 - 260, top: INTRO_H * 0.46 - 160, width: 520, height: 320, overflow: "visible", opacity: 1 - d.leave, transform: `scale(${backOut(between(d.f, d.hold - 8, d.hold - 2), 2.4)}) rotate(-5deg)` }}>
            {[-20, 190].map((x) => (
              <polygon key={x} points={`${x},-120 ${x - 170},0 ${x},120`} fill={d.colors.highlight} stroke={INK} strokeWidth={22} strokeLinejoin="round" />
            ))}
          </svg>
        </>
      )}
      <div style={{ ...FILL, background: "#ffffff", opacity: flash }} />
    </div>
  );
}

/** Two halves slam together along a slanted seam, like a versus screen; a flash where they meet, then they pull apart on the video */
function Split(d: Drawn) {
  const meet = backOut(between(d.f, 0, 12), 1.1);
  const open = easeIn(d.leave);
  const spark = d.f >= 9 ? 1 - between(d.f, 9, 19) : 0;
  const away = (1 - meet) * 72 + open * 78;
  const strip = easeOut(between(d.f, 14, 27));
  const gone = between(d.leave, 0, 0.45);
  return (
    <div style={FILL}>
      {/* Each half is wider than the screen: when they bounce past the seam, no edge shows behind them */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: "-30%", width: "130%", background: d.colors.dark, clipPath: "polygon(0 0, 70.77% 0, 52.31% 100%, 0 100%)", transform: `translateX(${-away / 1.3}%)` }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "130%", background: d.colors.accent, clipPath: "polygon(47.69% 0, 100% 0, 100% 100%, 29.23% 100%)", transform: `translateX(${away / 1.3}%)` }} />
      {/* The seam: a bright line where the two halves touch, as long as they do */}
      <div style={{ position: "absolute", left: "50%", top: "-15%", width: 18, height: "130%", marginLeft: -9, background: "#ffffff", opacity: between(d.f, 9, 11) * (1 - between(d.leave, 0, 0.2)), transform: "rotate(7.7deg)", boxShadow: `0 0 40px 10px ${d.colors.highlight}` }} />
      <div style={{ ...FILL, background: "#ffffff", opacity: 0.7 * spark }} />
      <div style={{ ...SAFE, opacity: 1 - gone, transform: `scale(${1 - 0.25 * gone})` }}>
        {d.logoBox(320, { marginBottom: 70, opacity: between(d.f, 10, 12), transform: `scale(${backOut(between(d.f, 10, 23), 2.3)})`, boxShadow: `0 0 0 14px #ffffff, 0 0 0 26px ${INK}` })}
        <div style={{ padding: "30px 60px 22px", background: INK, transform: `translateX(${(1 - strip) * -1200}px) rotate(-4deg)`, boxShadow: `14px 14px 0 ${d.colors.highlight}` }}>
          <Title d={d} color="#ffffff" line={() => ({})} />
        </div>
        <Signature d={d} color="#ffffff" tone="white" tag={{ textShadow: `0 4px 0 ${INK}` }} style={{ marginTop: 70, opacity: between(d.f, 26, 32), transform: `scale(${backOut(between(d.f, 26, 36))})` }} />
      </div>
    </div>
  );
}

/** An arcade screen: the tube switches on, the logo comes block by block, the title blinks in like "insert coin"; the tube goes out on the video */
function Arcade(d: Drawn) {
  const on = easeOut(between(d.f, 0, 5));
  // Out: squeezed to a bright line, then to a dot
  const flat = between(d.leave, 0, 0.6);
  const tall = d.leave > 0 ? Math.max(0.005, 1 - easeOut(flat)) : Math.max(0.012, on);
  const wide = d.leave > 0.6 ? Math.max(0, 1 - between(d.leave, 0.6, 1)) : 1;
  const bright = d.leave > 0 ? 1 + 2.5 * flat : 1 + 1.4 * (1 - on);
  // The logo is hidden by an 8 x 8 wall of blocks that go one by one, each at its own time
  const cells = 8;
  const gone = (i: number) => d.f >= 6 + noise(i * 7.3 + 1) * 16;
  // The title blinks a few times, then stays
  const lit = d.f >= 40 || (d.f >= 26 && Math.floor((d.f - 26) / 3) % 2 === 0);
  const corner = (x: 0 | 1, y: 0 | 1): CSSProperties => ({
    position: "absolute",
    [x ? "right" : "left"]: 84,
    [y ? "bottom" : "top"]: y ? 520 : 250,
    width: 120,
    height: 120,
    [x ? "borderRight" : "borderLeft"]: `14px solid ${d.colors.highlight}`,
    [y ? "borderBottom" : "borderTop"]: `14px solid ${d.colors.highlight}`,
    opacity: d.f >= 4 ? 1 : 0,
  });
  return (
    <div style={{ ...FILL, transform: `scale(${wide}, ${tall})`, filter: `brightness(${bright})` }}>
      <div style={{ ...FILL, background: "#0a0b13" }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 42%, ${d.colors.dark}, transparent 72%)` }} />
      <div style={corner(0, 0)} />
      <div style={corner(1, 0)} />
      <div style={corner(0, 1)} />
      <div style={corner(1, 1)} />
      <div style={SAFE}>
        <div style={{ position: "relative", marginBottom: 74 }}>
          {d.logoBox(320, {}, true)}
          <div style={{ position: "absolute", inset: -14, display: "grid", gridTemplateColumns: `repeat(${cells}, 1fr)`, gridTemplateRows: `repeat(${cells}, 1fr)` }}>
            {Array.from({ length: cells * cells }, (_, i) => (
              <div key={i} style={{ background: noise(i * 3.1) > 0.5 ? d.colors.accent : d.colors.highlight, opacity: gone(i) ? 0 : 1 }} />
            ))}
          </div>
        </div>
        <div style={{ opacity: lit ? 1 : 0 }}>
          <Title d={d} color={d.colors.highlight} line={() => ({ textShadow: `7px 7px 0 ${d.colors.accent}, 14px 14px 0 rgba(0,0,0,0.6)` })} />
        </div>
        <Signature d={d} color="#ffffff" style={{ marginTop: 64, opacity: d.f >= 36 ? 1 : 0 }} />
      </div>
      {/* The lines of the tube, over everything */}
      <div style={{ ...FILL, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.3) 0 4px, transparent 4px 8px)" }} />
    </div>
  );
}

/** A breaking-news ident: the channel's logo like a station's, a FLASH banner slamming across, the title opening in a lower third; the set lifts away */
function News(d: Drawn) {
  const out = easeIn(d.leave);
  const ident = backOut(between(d.f, 2, 14), 1.8);
  const banner = backOut(between(d.f, 8, 20), 1.1);
  const open = easeOut(between(d.f, 16, 30));
  const live = Math.floor(d.f / 8) % 2 === 0;
  return (
    <div style={{ ...FILL, transform: `translateY(${-100 * out}%)` }}>
      <div style={{ ...FILL, background: d.colors.dark }} />
      <div style={{ position: "absolute", inset: "-25%", backgroundImage: "repeating-linear-gradient(115deg, transparent 0 230px, rgba(255,255,255,0.05) 230px 460px)", transform: `translateX(${d.f * 3}px)` }} />
      <div style={SAFE}>
        <div style={{ position: "relative", marginBottom: 56, transform: `scale(${ident})`, opacity: between(d.f, 2, 4) }}>
          {d.logoBox(280)}
          <div style={{ position: "absolute", top: -10, left: "100%", marginLeft: -40, display: "flex", alignItems: "center", gap: 12, padding: "8px 18px 8px 14px", background: "#e5383b", color: "#ffffff", fontFamily: GEIST, fontWeight: 800, fontSize: 34, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#ffffff", opacity: live ? 1 : 0.25 }} />
            LIVE
          </div>
        </div>
        {/* The banner runs past both edges of the screen */}
        <div style={{ alignSelf: "stretch", margin: "0 -200px", padding: "18px 0 10px", background: d.colors.accent, transform: `translateX(${(1 - banner) * -1500}px) skewX(-10deg)`, boxShadow: `0 14px 0 ${d.colors.highlight}` }}>
          <div style={{ fontFamily: d.font, fontSize: 150, lineHeight: 1, letterSpacing: "0.04em", color: inkOn(d.colors.accent), transform: "skewX(10deg)" }}>FLASH</div>
        </div>
        <div style={{ marginTop: 58, padding: "30px 48px 22px", background: "#ffffff", clipPath: `inset(0 ${(1 - open) * 100}% 0 0)`, boxShadow: `16px 16px 0 ${INK}` }}>
          <Title d={{ ...d, size: Math.round(d.size * 0.82) }} color={INK} line={() => ({})} />
        </div>
        <Signature d={d} color="#ffffff" style={{ marginTop: 56, opacity: between(d.f, 30, 36), transform: `translateY(${(1 - easeOut(between(d.f, 30, 40))) * 40}px)` }} />
      </div>
    </div>
  );
}

/** Where the screen breaks: twelve shards around the point the logo hits, each with the way it flies off */
const BREAK = { x: 50, y: 40 };
const SHARDS = (() => {
  const edge: [number, number][] = [[0, 0], [34, 0], [68, 0], [100, 0], [100, 28], [100, 60], [100, 100], [62, 100], [28, 100], [0, 100], [0, 62], [0, 30]];
  return edge.map(([x, y], i) => {
    const [nx, ny] = edge[(i + 1) % edge.length];
    const mid = { x: (x + nx + BREAK.x) / 3, y: (y + ny + BREAK.y) / 3 };
    return { clip: `polygon(${BREAK.x}% ${BREAK.y}%, ${x}% ${y}%, ${nx}% ${ny}%)`, mid, dx: mid.x - BREAK.x, dy: mid.y - BREAK.y, spin: (i % 2 ? 1 : -1) * (16 + ((i * 7) % 22)), to: [x, y] as [number, number] };
  });
})();

/** The logo hits the screen, which cracks around it; the title slams in, then the whole screen falls in pieces onto the video */
function Shatter(d: Drawn) {
  const hit = backOut(between(d.f, 0, 10), 2.6);
  const crack = easeOut(between(d.f, 8, 15));
  const shake = d.f >= 8 && d.f < 18 ? (1 - between(d.f, 8, 18)) * 20 : 0;
  const screen = (
    <>
      <div style={{ ...FILL, background: d.colors.dark }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at ${BREAK.x}% ${BREAK.y}%, ${d.colors.accent}, transparent 60%)`, opacity: d.f < 8 ? 0.15 : 0.3 + 0.45 * (1 - between(d.f, 8, 26)) }} />
      <svg viewBox={`0 0 ${INTRO_W} ${INTRO_H}`} style={{ ...FILL, width: "100%", height: "100%" }}>
        {SHARDS.map((shard, i) => {
          const from = [BREAK.x * 10.8, BREAK.y * 19.2];
          const to = [shard.to[0] * 10.8, shard.to[1] * 19.2];
          // A crack is not a straight line: it turns once on its way to the edge
          const turn = [(from[0] + to[0]) / 2 + (noise(i * 5.1) - 0.5) * 150, (from[1] + to[1]) / 2 + (noise(i * 9.7) - 0.5) * 150];
          const length = 2600;
          return (
            <polyline key={i} points={`${from} ${turn} ${to}`} fill="none" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={i % 3 ? 4 : 7} strokeDasharray={length} strokeDashoffset={length * (1 - crack)} />
          );
        })}
      </svg>
      <div style={{ ...SAFE, transform: `translate(${shake * (noise(d.f * 3.1) - 0.5) * 2}px, ${shake * (noise(d.f * 7.7) - 0.5) * 2}px)` }}>
        {d.logoBox(330, { marginBottom: 66, opacity: between(d.f, 0, 3), transform: `scale(${hit})` })}
        <Title d={d} color="#ffffff" line={(i) => ({ opacity: between(d.f, 12 + i * 3, 15 + i * 3), transform: `scale(${1.8 - 0.8 * backOut(between(d.f, 12 + i * 3, 24 + i * 3))})`, textShadow: `8px 9px 0 ${d.colors.accent}` })} />
        <Signature d={d} color="#ffffff" style={{ marginTop: 56, opacity: between(d.f, 26, 32), transform: `scale(${backOut(between(d.f, 26, 36))})` }} />
      </div>
    </>
  );
  if (d.leave === 0) return <div style={FILL}>{screen}</div>;
  // Each shard is the whole screen seen through its own triangle, thrown outwards and down
  const out = easeIn(d.leave);
  return (
    <div style={FILL}>
      {SHARDS.map((shard, i) => (
        <div key={i} style={{ ...FILL, clipPath: shard.clip, transformOrigin: `${shard.mid.x}% ${shard.mid.y}%`, transform: `translate(${shard.dx * out * 3.4}%, ${shard.dy * out * 3.4 + out * out * 45}%) rotate(${shard.spin * out}deg)` }}>
          {screen}
        </div>
      ))}
    </div>
  );
}

/** Where the ink of a glyph is around its origin (the left end of its baseline), in ems */
interface Ink {
  left: number;
  right: number;
  up: number;
  down: number;
}
const INKS = new Map<string, Ink>();
/** A usual digit, when nothing can measure it */
const ROUGH: Ink = { left: 0.04, right: 0.56, up: 0.72, down: 0 };

/**
 * A font's line box says little about where its glyphs are drawn (each font has its own
 * ascent, some sit high, a "1" is narrower than its advance): to put a glyph on a point, its
 * ink is measured. Asked again each frame until the font is there.
 */
function inkOf(char: string, font: string): Ink {
  const key = `${font}|${char}`;
  const known = INKS.get(key);
  if (known) return known;
  // No canvas outside a browser
  if (typeof document === "undefined" || /jsdom/i.test(globalThis.navigator?.userAgent ?? "")) return ROUGH;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return ROUGH;
    const spec = `200px ${font}`;
    ctx.font = spec;
    // A family the canvas cannot read leaves its own font in place
    if (!ctx.font.includes("200px")) return ROUGH;
    const m = ctx.measureText(char);
    const ink = { left: -m.actualBoundingBoxLeft / 200, right: m.actualBoundingBoxRight / 200, up: m.actualBoundingBoxAscent / 200, down: m.actualBoundingBoxDescent / 200 };
    if (!(ink.right > ink.left) || !(ink.up + ink.down > 0)) return ROUGH;
    // Measured on a stand-in while the font loads: not kept
    if (document.fonts?.check(spec, char)) INKS.set(key, ink);
    return ink;
  } catch {
    return ROUGH;
  }
}

/** The centre of the leader's target */
const TARGET = { x: INTRO_W / 2, y: INTRO_H * 0.45 };
const DIGIT = 620;

/** A film leader counts 3, 2, 1 on worn stock, a hand sweeping round each number; then the logo and the title hit */
function Countdown(d: Drawn) {
  const each = 9;
  const number = d.f < 3 * each ? 3 - Math.floor(d.f / each) : 0;
  const turned = (d.f % each) / each;
  const go = d.f - 3 * each;
  const out = easeIn(d.leave);
  if (number > 0) {
    const ink = inkOf(String(number), d.font);
    return (
      <div style={{ ...FILL, filter: `brightness(${0.9 + 0.12 * noise(d.f * 1.9)})` }}>
        <div style={{ ...FILL, background: d.colors.light }} />
        {/* The hand: what it has swept is darker */}
        <div style={{ ...FILL, background: `conic-gradient(from 0deg at 50% 45%, rgba(0,0,0,0.2) ${turned * 360}deg, transparent 0)` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: "45%", height: 6, marginTop: -3, background: INK, opacity: 0.55 }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 6, marginLeft: -3, background: INK, opacity: 0.55 }} />
        {[760, 560].map((size) => (
          <div key={size} style={{ position: "absolute", left: "50%", top: "45%", width: size, height: size, margin: `${-size / 2}px 0 0 ${-size / 2}px`, borderRadius: "50%", border: `8px solid ${INK}`, opacity: 0.6 }} />
        ))}
        {/* The number, its ink centred on the cross */}
        <svg viewBox={`0 0 ${INTRO_W} ${INTRO_H}`} style={{ ...FILL, width: "100%", height: "100%", overflow: "visible", transformOrigin: "50% 45%", transform: `scale(${1.3 - 0.3 * easeOut(between(turned, 0, 0.4))})` }}>
          <text x={TARGET.x - ((ink.left + ink.right) / 2) * DIGIT} y={TARGET.y + ((ink.up - ink.down) / 2) * DIGIT} fill={INK} style={{ fontFamily: d.font, fontSize: DIGIT }}>
            {number}
          </text>
        </svg>
        {/* Scratches on the film, never twice at the same place */}
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${noise(d.f * 2.7 + i * 13) * 100}%`, width: i ? 3 : 5, background: INK, opacity: 0.22 }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ ...FILL, opacity: 1 - out, transform: `scale(${1 + 0.5 * out})` }}>
      <div style={{ ...FILL, background: d.colors.accent }} />
      {/* Rays turning slowly behind the logo, as on a cinema poster */}
      <div style={{ position: "absolute", left: "50%", top: "42%", width: 2800, height: 2800, margin: "-1400px 0 0 -1400px", background: `repeating-conic-gradient(from ${go * 0.8}deg, ${d.colors.dark} 0 8deg, transparent 0 20deg)`, opacity: 0.2 }} />
      <div style={{ ...FILL, background: `radial-gradient(circle at 50% 42%, ${d.colors.light}, transparent 50%)`, opacity: 0.6 }} />
      <div style={{ ...FILL, boxShadow: "inset 0 0 420px rgba(0,0,0,0.45)" }} />
      <div style={SAFE}>
        {d.logoBox(330, { marginBottom: 66, transform: `scale(${backOut(between(go, 0, 10), 2.4)}) rotate(${-6 + 6 * easeOut(between(go, 0, 12))}deg)`, boxShadow: `0 0 0 14px ${INK}, 0 0 0 28px #ffffff` })}
        <div style={{ transform: "rotate(-4deg)" }}>
          <Title d={d} color="#ffffff" line={(i) => ({ opacity: between(go, 3 + i * 3, 5 + i * 3), transform: `scale(${1.9 - 0.9 * backOut(between(go, 3 + i * 3, 14 + i * 3))})`, WebkitTextStroke: `${Math.round(d.size * 0.09)}px ${INK}`, paintOrder: "stroke fill", textShadow: `9px 11px 0 ${d.colors.highlight}` })} />
        </div>
        <Signature d={d} color={INK} tone="ink" tag={{ padding: "10px 30px 8px", background: "#ffffff" }} style={{ marginTop: 56, opacity: between(go, 12, 16), transform: `scale(${backOut(between(go, 12, 22))})` }} />
      </div>
      {/* Still film: a scratch runs down it now and then */}
      {[0, 1].map((i) => (
        <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${noise(Math.floor(d.f / 2) * 3.3 + i * 17) * 100}%`, width: i ? 3 : 5, background: INK, opacity: 0.16 }} />
      ))}
      {/* The last frame of the leader burns out in white */}
      <div style={{ ...FILL, background: "#ffffff", opacity: 1 - between(go, 0, 5) }} />
    </div>
  );
}

const DRAW: Record<IntroId, (d: Drawn) => ReactNode> = { hook: Hook, slam: Slam, bands: Bands, glitch: Glitch, neon: Neon, rush: Rush, split: Split, arcade: Arcade, news: News, shatter: Shatter, countdown: Countdown };

/**
 * One frame of an intro, in a 1080 x 1920 box. It takes its frame as a number
 * (no clock of its own): the video gives it Remotion's, the picker its own loop.
 */
export default function IntroCard({ id, frame, fps, title, name, logo, colors, font, follow = null, over = false, hold: held, Img = Plain }: IntroCardProps) {
  const f = (frame * 30) / fps;
  const span = introSpan(id, 30);
  // (a hook holds the screen for as long as its moment lasts: its caller says how long)
  const hold = held ? (held * 30) / fps : span.hold;
  const out = span.out;
  const { lines, size } = titleLines(title || name, font);
  const logoBox = (box: number, style: CSSProperties = {}, square = false) => (
    <div
      style={{
        width: box,
        height: box,
        flex: "none",
        borderRadius: square ? "22%" : "50%",
        overflow: "hidden",
        background: colors.light,
        boxShadow: `0 0 0 ${Math.round(box * 0.04)}px ${colors.accent}`,
        display: "grid",
        placeItems: "center",
        ...style,
      }}
    >
      {logo ? <Img src={logo} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontFamily: font, fontSize: box * 0.5, color: colors.dark }}>{name.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
  return (
    <div style={{ position: "relative", width: INTRO_W, height: INTRO_H, overflow: "hidden" }}>
      {DRAW[id]({ f, hold, leave: between(f, hold, hold + out), lines, size, title, name, logo, colors, font, follow, over, logoBox })}
    </div>
  );
}
