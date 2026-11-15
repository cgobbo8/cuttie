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

interface Drawn extends Required<Omit<IntroCardProps, "id" | "frame" | "fps" | "Img" | "follow">> {
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

/** A star with as many points, to burst behind a logo */
const STAR = `polygon(${Array.from({ length: 32 }, (_, i) => {
  const radius = i % 2 ? 37 : 50;
  const angle = (i / 32) * 2 * Math.PI;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
}).join(", ")})`;

/** Stickers slapped on a wall of dots: the logo first, then each line of the title, each a little crooked; they fly off to show the video */
function Sticker(d: Drawn) {
  const slap = backOut(between(d.f, 4, 15), 2.6);
  const fly = easeIn(d.leave);
  const tilt = [-4, 3, -2, 4];
  return (
    <div style={FILL}>
      <div style={{ ...FILL, background: d.colors.accent, opacity: 1 - fly }} />
      <div
        style={{ ...FILL, backgroundImage: `radial-gradient(${d.colors.highlight} 21%, transparent 23%)`, backgroundSize: "58px 58px", backgroundPosition: `${d.f * 1.4}px ${d.f * 1.4}px`, opacity: 0.6 * (1 - fly) }}
      />
      <div style={SAFE}>
        <div style={{ position: "relative", marginBottom: 76, opacity: between(d.f, 4, 6), transform: `translate(${fly * -900}px, ${fly * -800}px) rotate(${-7 - fly * 40}deg) scale(${1.7 - 0.7 * slap})` }}>
          <div style={{ position: "absolute", inset: -96, background: d.colors.highlight, clipPath: STAR, transform: `rotate(${d.f * 1.6}deg)` }} />
          {d.logoBox(310, { position: "relative", boxShadow: `0 0 0 16px #ffffff, 14px 18px 0 16px ${INK}` })}
        </div>
        {d.lines.map((text, i) => {
          const side = i % 2 ? 1 : -1;
          return (
            <div
              key={i}
              style={{
                fontFamily: d.font,
                fontSize: Math.round(d.size * 0.84),
                lineHeight: 1,
                whiteSpace: "nowrap",
                color: INK,
                background: "#ffffff",
                padding: "16px 36px 10px",
                marginTop: i ? -8 : 0,
                boxShadow: `10px 12px 0 ${INK}`,
                transform: `translate(${fly * side * 1150}px, ${fly * (180 + i * 130)}px) rotate(${tilt[i % 4] + fly * side * 30}deg) scale(${backOut(between(d.f, 12 + i * 5, 23 + i * 5), 2.4)})`,
              }}
            >
              {text}
            </div>
          );
        })}
        <Signature d={d} color="#ffffff" tone="white" tag={{ padding: "12px 30px 10px", background: INK }} style={{ marginTop: 48, transform: `translateY(${fly * 1000}px) rotate(2deg) scale(${backOut(between(d.f, 30, 41))})` }} />
      </div>
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

const DRAW: Record<IntroId, (d: Drawn) => ReactNode> = { slam: Slam, bands: Bands, glitch: Glitch, neon: Neon, rush: Rush, sticker: Sticker, split: Split };

/**
 * One frame of an intro, in a 1080 x 1920 box. It takes its frame as a number
 * (no clock of its own): the video gives it Remotion's, the picker its own loop.
 */
export default function IntroCard({ id, frame, fps, title, name, logo, colors, font, follow = null, Img = Plain }: IntroCardProps) {
  const f = (frame * 30) / fps;
  const { hold, out } = introSpan(id, 30);
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
      {DRAW[id]({ f, hold, leave: between(f, hold, hold + out), lines, size, title, name, logo, colors, font, follow, logoBox })}
    </div>
  );
}
