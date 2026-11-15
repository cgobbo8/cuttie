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

interface Drawn extends Required<Omit<IntroCardProps, "id" | "frame" | "fps" | "Img">> {
  /** Frames at 30 a second, whatever the video's own rate */
  f: number;
  hold: number;
  /** 0 while the intro holds the screen, up to 1 as it leaves */
  leave: number;
  lines: string[];
  size: number;
  logoBox: (size: number, style?: CSSProperties, square?: boolean) => ReactNode;
}

/** The title, line by line (`masked`: each line moves behind its own window, so it can rise into view) */
function Title({ d, color, line, masked = false }: { d: Drawn; color: string; line: (i: number) => CSSProperties; masked?: boolean }) {
  return (
    <div style={{ fontFamily: d.font, fontSize: d.size, lineHeight: 1.06, color, letterSpacing: "0.01em" }}>
      {d.lines.map((text, i) => (
        <div key={i} style={masked ? { overflow: "hidden", padding: "0.08em 0 0.04em" } : undefined}>
          <div style={{ whiteSpace: "nowrap", ...line(i) }}>{text}</div>
        </div>
      ))}
    </div>
  );
}

const Name = ({ d, color, style }: { d: Drawn; color: string; style?: CSSProperties }) => (
  <div style={{ fontFamily: '"Geist Variable", "Geist", system-ui, sans-serif', fontWeight: 650, fontSize: 44, letterSpacing: "0.08em", textTransform: "uppercase", color, ...style }}>{d.name}</div>
);

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
        <Name d={d} color={d.colors.accent} style={{ marginTop: 46, opacity: between(d.f, 24, 34), transform: `translateY(${(1 - easeOut(between(d.f, 24, 34))) * 40}px)` }} />
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
        <Name d={d} color={inkOn(d.colors.dark)} style={{ marginTop: 74, opacity: between(d.f, 31, 41) }} />
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
        <Name d={d} color="#ffffff" style={{ marginTop: 60, opacity: 0.75 }} />
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
        <Name d={d} color="#ffffff" style={{ marginTop: 44, opacity: 0.8 * between(d.f, 36, 48), letterSpacing: "0.3em" }} />
      </div>
    </div>
  );
}

/** A title card in the channel's colour: the words rise one line after the other, then the whole card lifts like a curtain */
function Card(d: Drawn) {
  const ink = inkOn(d.colors.accent);
  const chip = backOut(between(d.f, 22, 36));
  return (
    <div style={{ ...FILL, transform: `translateY(${-100 * easeIn(d.leave)}%)` }}>
      <div style={{ ...FILL, background: d.colors.accent }} />
      <div style={{ ...FILL, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.07) 0 26px, transparent 26px 52px)" }} />
      <div style={{ ...SAFE, alignItems: "flex-start", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, padding: "16px 38px 16px 16px", borderRadius: 999, background: ink, marginBottom: 70, transform: `scale(${chip})`, transformOrigin: "left center" }}>
          {d.logoBox(104, { boxShadow: "none" })}
          <Name d={d} color={d.colors.accent} />
        </div>
        <Title d={d} color={ink} masked line={(i) => ({ transform: `translateY(${(1 - easeOut(between(d.f, 3 + i * 5, 17 + i * 5))) * 115}%)` })} />
        <div style={{ marginTop: 46, height: 24, width: `${100 * easeOut(between(d.f, 18, 34))}%`, background: ink }} />
      </div>
    </div>
  );
}

const DRAW: Record<IntroId, (d: Drawn) => ReactNode> = { slam: Slam, bands: Bands, glitch: Glitch, neon: Neon, card: Card };

/**
 * One frame of an intro, in a 1080 x 1920 box. It takes its frame as a number
 * (no clock of its own): the video gives it Remotion's, the picker its own loop.
 */
export default function IntroCard({ id, frame, fps, title, name, logo, colors, font, Img = Plain }: IntroCardProps) {
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
      {DRAW[id]({ f, hold, leave: between(f, hold, hold + out), lines, size, title, name, logo, colors, font, logoBox })}
    </div>
  );
}
