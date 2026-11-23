/**
 * The widgets of the GTA pack: an evening in Vice City. Drawn with the pack's own colours and
 * lettering whatever the channel's are (see lib/intro/IntroCard.tsx, which opens a video the same
 * way). Nothing here is taken from the game: no logo, no artwork, no font of its publisher.
 */
import type { CSSProperties } from "react";
import WidgetImg from "./WidgetImg";
import { clamp01, easeOutBack, num, since, text, type KitWidgetProps } from "./shared";

export const VICE = { night: "#160b36", indigo: "#2f2a93", violet: "#6a43cc", orchid: "#b44fcf", pink: "#ff4f9e", coral: "#ff7b68", orange: "#ffa047", sun: "#ffd772", teal: "#36e2d2" };
const INK = "#0b0b0c";
const HEAVY = '"Rammetto One", "Luckiest Guy", system-ui, sans-serif';
const SCRIPT = '"Mr Dafoe", "Permanent Marker", cursive';

/** A fat five-pointed star with a black outline, as a wanted level is counted */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const radius = i % 2 ? 22 : 47;
  const angle = -Math.PI / 2 + (i * Math.PI) / 5;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(53 + radius * Math.sin(angle)).toFixed(1)}`;
}).join(" ");


/**
 * Six stars that light up one after the other as the clip plays, each thrown on with a little
 * bounce: how far along the video is, said as a wanted level. Once the sixth is on they all
 * blink red and blue, like the lights of a police car, until the end.
 */
export function GtaWanted({ props, width, height, currentTime = 0 }: KitWidgetProps) {
  const start = num(props, "startAt", 0);
  const length = Math.max(0.1, num(props, "endAt", start + 60) - start);
  const size = Math.min(height, width / 6.3);
  // The sixth lands a moment before the end, so that the blinking is seen
  const lands = (i: number) => start + ((i + 1) / 6) * Math.max(0.5, length - Math.min(2, length * 0.12));
  const all = currentTime >= lands(5);
  const blink = all && Math.floor((currentTime - lands(5)) * 5) % 2 === 1;
  return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: size * 0.05 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const on = currentTime >= lands(i);
        const pop = on ? easeOutBack((currentTime - lands(i)) / 0.3) : 0;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 100 100" style={{ flex: "none", overflow: "visible", transform: `scale(${on ? 0.5 + 0.5 * pop : 1}) rotate(${on ? (1 - pop) * -40 : 0}deg)` }}>
            <polygon points={STAR} fill={!on ? "rgba(0,0,0,0.45)" : blink ? (i % 2 ? "#5f8bff" : "#ff4d6d") : "#ffffff"} stroke={INK} strokeWidth={10} strokeLinejoin="round" />
          </svg>
        );
      })}
    </div>
  );
}

/** A strip of sunset between two pictures (the webcam and the game): the sky of the pack, from violet to yellow, drifting slowly, between two black lines */
export function GtaSeam({ props, width, height, currentTime = 0 }: KitWidgetProps) {
  const drift = (since(props, currentTime) * 3) % 100;
  const line = Math.max(3, height * 0.2);
  return (
    <div style={{ width, height, background: INK, padding: `${line}px 0`, boxSizing: "border-box" }}>
      <div style={{ width: "100%", height: "100%", backgroundImage: `linear-gradient(90deg, ${VICE.indigo}, ${VICE.violet}, ${VICE.orchid}, ${VICE.pink}, ${VICE.coral}, ${VICE.sun}, ${VICE.coral}, ${VICE.pink}, ${VICE.orchid}, ${VICE.violet}, ${VICE.indigo})`, backgroundSize: "200% 100%", backgroundPosition: `${drift}% 0` }} />
    </div>
  );
}

/**
 * The word a mission ends on, over the whole picture: it goes grey and slows to a stop under a
 * dark band, and the word is stamped across it. Red and heavy when it went wrong ("WASTED"), a
 * yellow script when it went well ("Mission réussie").
 */
function Verdict({ props, width, height, currentTime, won }: KitWidgetProps & { won: boolean }) {
  const t = Math.max(0, since(props, currentTime));
  const word = text(props, "text", won ? "Mission réussie" : "WASTED");
  const grey = clamp01(t / 0.5);
  const stamp = easeOutBack(clamp01((t - 0.25) / 0.35));
  const shown = t >= 0.25;
  // As big as the band bears, never wider than the picture (a script's letters are half as wide as heavy capitals)
  const size = won ? Math.min(height * 0.12, (width * 0.86) / (Math.max(6, word.length) * 0.4)) : Math.min(height * 0.085, (width * 0.86) / (Math.max(4, word.length) * 0.8));
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>
      {/* What is under it: drained of its colours when it went wrong, warmed when it went well */}
      <div style={{ position: "absolute", inset: 0, backdropFilter: won ? `saturate(${1 + 0.3 * grey}) brightness(${1 - 0.18 * grey})` : `grayscale(${grey}) contrast(${1 + 0.15 * grey}) brightness(${1 - 0.22 * grey})` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: "41%", height: "18%", background: "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.78) 18%, rgba(0,0,0,0.78) 82%, rgba(0,0,0,0))", opacity: grey }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: "41%", height: "18%", display: "grid", placeItems: "center", opacity: shown ? 1 : 0, transform: `scale(${2.2 - 1.2 * stamp})` }}>
        <div
          style={
            won
              ? { fontFamily: SCRIPT, fontSize: size, lineHeight: 1, color: VICE.sun, whiteSpace: "nowrap", transform: "rotate(-5deg)", textShadow: `0 ${size * 0.05}px 0 ${INK}, 0 0 ${size * 0.35}px rgba(255, 215, 114, 0.6)` }
              : { fontFamily: HEAVY, fontSize: size, lineHeight: 1, color: "#e02b3c", whiteSpace: "nowrap", letterSpacing: "0.04em", WebkitTextStroke: `${size * 0.1}px ${INK}`, paintOrder: "stroke fill", textShadow: `0 ${size * 0.08}px 0 ${INK}` }
          }
        >
          {word}
        </div>
      </div>
    </div>
  );
}

export const GtaWasted = (p: KitWidgetProps) => <Verdict {...p} won={false} />;
export const GtaMission = (p: KitWidgetProps) => <Verdict {...p} won />;

/* ── The frames and the titles of the pack ───────────────────── */

const SUNSET = `linear-gradient(90deg, ${VICE.violet}, ${VICE.orchid}, ${VICE.pink}, ${VICE.coral}, ${VICE.sun})`;
const SKY = `linear-gradient(180deg, ${VICE.indigo} 0%, ${VICE.violet} 22%, ${VICE.orchid} 44%, ${VICE.pink} 64%, ${VICE.coral} 80%, ${VICE.sun} 100%)`;
const CAPS = '"Bebas Neue", "Anton", system-ui, sans-serif';
const FILL: CSSProperties = { position: "absolute", inset: 0 };
/** A box whose sides lean: how far, as a share of its width */
const leaning = (lean: number) => `polygon(${lean}% 0, 100% 0, ${100 - lean}% 100%, 0 100%)`;

/**
 * The box a title sits in: a black plate whose sides lean, a white edge round it and a strip of
 * sunset under it, like the box a game's name is written in on its cover. A light runs across it
 * once when it shows up. The title itself is written over it by the template (its hook line, the
 * title of a part of a compilation); alone, it is a plate to put behind anything.
 */
export function GtaPlate({ props, width, height, currentTime }: KitWidgetProps) {
  const t = Math.max(0, since(props, currentTime));
  const lean = Math.min(9, ((height * 0.2) / Math.max(1, width)) * 100);
  const edge = Math.max(5, height * 0.055);
  const drop = Math.max(8, height * 0.1);
  const shine = clamp01((t - 0.15) / 0.5);
  return (
    <div style={{ position: "relative", width, height }}>
      <div style={{ ...FILL, background: SUNSET, clipPath: leaning(lean), transform: `translate(${drop}px, ${drop}px)` }} />
      <div style={{ ...FILL, background: "#ffffff", clipPath: leaning(lean) }} />
      <div style={{ position: "absolute", inset: edge, background: `linear-gradient(170deg, #241056, ${INK} 70%)`, clipPath: leaning(lean), overflow: "hidden" }}>
        {shine > 0 && shine < 1 && <div style={{ ...FILL, background: "linear-gradient(105deg, transparent 0 40%, rgba(255, 255, 255, 0.28) 50%, transparent 60% 100%)", backgroundSize: "300% 100%", backgroundPosition: `${100 - shine * 100}% 0` }} />}
      </div>
    </div>
  );
}

/** The channel as the pack signs it: its logo ringed in white and black, and its address on a leaning black plate */
export function GtaTag({ props, width, height }: KitWidgetProps) {
  const login = text(props, "login") || text(props, "displayName");
  const avatar = text(props, "avatarUrl");
  const ring = Math.max(3, height * 0.07);
  const size = height * 0.5;
  return (
    <div style={{ width, height, display: "flex", alignItems: "center" }}>
      <div style={{ position: "relative", zIndex: 1, flex: "none", width: height - ring * 4, height: height - ring * 4, margin: ring * 2, borderRadius: "50%", overflow: "hidden", background: VICE.night, boxShadow: `0 0 0 ${ring}px #ffffff, 0 0 0 ${ring * 2}px ${INK}`, display: "grid", placeItems: "center" }}>
        {avatar ? <WidgetImg src={avatar} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontFamily: HEAVY, fontSize: size, color: "#ffffff" }}>{login.slice(0, 1).toLowerCase()}</span>}
      </div>
      {login && (
        <div style={{ position: "relative", marginLeft: -height * 0.22, height: height * 0.78 }}>
          <div style={{ ...FILL, background: VICE.pink, clipPath: leaning(6), transform: `translate(${ring * 1.4}px, ${ring * 1.4}px)` }} />
          <div style={{ ...FILL, background: "#ffffff", clipPath: leaning(6) }} />
          <div style={{ position: "absolute", inset: ring * 0.8, background: INK, clipPath: leaning(6) }} />
          <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", gap: height * 0.04, padding: `0 ${height * 0.42}px 0 ${height * 0.44}px`, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: CAPS, fontSize: size * 0.86, letterSpacing: "0.04em", color: VICE.pink }}>TWITCH.TV/</span>
            <span style={{ fontFamily: HEAVY, fontSize: size * 0.78, color: "#ffffff" }}>{login.toLowerCase()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A frame round a picture (the webcam, the game): a line of sunset between two black ones, and a
 * hard shadow down to the right, as a panel is framed on a cover. It is put under the picture, a
 * little larger than it: the picture covers its middle.
 */
export function GtaFrame({ width, height }: KitWidgetProps) {
  const line = Math.max(8, Math.min(width, height) * 0.022);
  return (
    <div style={{ position: "relative", width, height }}>
      <div style={{ ...FILL, background: "rgba(22, 11, 54, 0.78)", transform: `translate(${line * 1.6}px, ${line * 1.8}px)` }} />
      <div style={{ ...FILL, background: INK }} />
      <div style={{ position: "absolute", inset: line * 0.55, background: SUNSET }} />
      <div style={{ position: "absolute", inset: line * 1.45, background: INK }} />
    </div>
  );
}

/** The same number for the same seed, between 0 and 1 */
const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** A palm in silhouette (as the pack's intros draw them: lib/intro/IntroCard.tsx), in a 600 x 900 box with its foot at the middle of the bottom */
function palm(seed: number, lean: number): string {
  const n = (value: number) => value.toFixed(0);
  const head = [300 + 130 * lean, 250];
  const bend = [300 - 40 * lean, 600];
  const parts = [`M272 900Q${n(bend[0] - 20)} ${bend[1]} ${n(head[0] - 9)} ${head[1]}L${n(head[0] + 9)} ${head[1]}Q${n(bend[0] + 24)} ${bend[1]} 334 900Z`];
  for (let i = 0; i < 9; i++) {
    const angle = Math.PI * (1.1 - (i / 8) * 1.2) + (noise(seed + i * 3.1) - 0.5) * 0.24;
    const long = 235 + noise(seed + i * 7.7) * 95;
    const [dx, dy] = [Math.cos(angle), -Math.sin(angle)];
    const knee = [head[0] + dx * long * 0.55, head[1] + dy * long * 0.55 - 56];
    const tip = [head[0] + dx * long, head[1] + dy * long + 96 + 76 * Math.abs(dx)];
    const at = (t: number) => [(1 - t) ** 2 * head[0] + 2 * (1 - t) * t * knee[0] + t * t * tip[0], (1 - t) ** 2 * head[1] + 2 * (1 - t) * t * knee[1] + t * t * tip[1]];
    for (let k = 1; k <= 15; k++) {
      const t = k / 15;
      const [x, y] = at(t);
      const [px, py] = at(t - 1 / 15);
      const length = Math.hypot(x - px, y - py) || 1;
      const [ux, uy] = [(x - px) / length, (y - py) / length];
      const half = 7 * (1 - t) + 1.5;
      parts.push(`M${n(px - uy * half)} ${n(py + ux * half)}L${n(x - uy * half)} ${n(y + ux * half)}L${n(x + uy * half)} ${n(y - ux * half)}L${n(px + uy * half)} ${n(py - ux * half)}Z`);
      const reach = (24 + 80 * Math.sin(Math.PI * t ** 0.75)) * (0.8 + 0.4 * noise(seed + i * 13 + k));
      const [gx, gy] = [ux * 0.5, uy * 0.5 + 0.85];
      const g = Math.hypot(gx, gy);
      parts.push(`M${n(px)} ${n(py)}L${n(x + ux * 5)} ${n(y + uy * 5)}L${n(x + (gx / g) * reach)} ${n(y + (gy / g) * reach)}Z`);
      const up = ux < 0 ? 1 : -1;
      const [hx, hy] = [ux * 0.8 - uy * up * 0.55, uy * 0.8 + ux * up * 0.55];
      const h = Math.hypot(hx, hy);
      parts.push(`M${n(px)} ${n(py)}L${n(x + ux * 5)} ${n(y + uy * 5)}L${n(x + (hx / h) * reach * 0.62)} ${n(y + (hy / h) * reach * 0.62)}Z`);
    }
  }
  return parts.join("");
}
const PALMS = [palm(1, 1), palm(2, -1)];
const STEPPED = "polygon(0 7%, 16% 7%, 16% 3%, 38% 3%, 38% 0, 62% 0, 62% 3%, 84% 3%, 84% 7%, 100% 7%, 100% 100%, 0 100%)";

/**
 * What stands behind the pictures when they are cards: an evening in Vice City. The sky of the
 * pack, a low sun and its rays turning slowly, a row of hotels, a tall palm on each side that sways.
 * Quiet on purpose: it is a backdrop, what is watched is in front of it.
 */
export function GtaSky({ props, width, height, currentTime }: KitWidgetProps) {
  const t = Math.max(0, since(props, currentTime));
  const k = width / 1080;
  const sun = 640 * k;
  const fade = "radial-gradient(circle, #000 18%, transparent 68%)";
  const hotel = (x: number, w: number, h: number, color: string): CSSProperties => ({ position: "absolute", left: x * k, bottom: 0, width: w * k, height: h * k, background: color, clipPath: STEPPED });
  const palmAt = (shape: number, x: number, tall: number, phase: number) => (
    <svg viewBox="0 0 600 900" style={{ position: "absolute", left: x * k - (tall * k) / 3, bottom: 0, width: (tall * k * 2) / 3, height: tall * k, overflow: "visible", transformOrigin: "50% 100%", transform: `rotate(${(1.6 * Math.sin(t / 2.3 + phase)).toFixed(2)}deg)` }}>
      <path d={PALMS[shape]} fill="#3d1856" />
    </svg>
  );
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", background: SKY }}>
      <div style={{ position: "absolute", left: width / 2 - 1150 * k, top: height * 0.8 - 1150 * k, width: 2300 * k, height: 2300 * k, background: `repeating-conic-gradient(from ${(t * 4).toFixed(1)}deg, rgba(255, 243, 196, 0.5) 0deg 5deg, transparent 5deg 15deg)`, maskImage: fade, WebkitMaskImage: fade, opacity: 0.36 }} />
      <div style={{ position: "absolute", left: width / 2 - sun / 2, top: height * 0.8 - sun / 2, width: sun, height: sun, borderRadius: "50%", background: `linear-gradient(180deg, #fff3c4 0%, ${VICE.sun} 34%, ${VICE.orange} 70%, ${VICE.pink} 100%)`, boxShadow: `0 0 ${190 * k}px ${70 * k}px rgba(255, 215, 114, 0.5)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.4, background: `linear-gradient(180deg, transparent, rgba(255, 160, 71, 0.5) 55%, ${VICE.sun})` }} />
      <div style={hotel(-40, 300, 470, "#c96fb8")} />
      <div style={hotel(330, 220, 380, "#d985b6")} />
      <div style={hotel(800, 330, 520, "#c96fb8")} />
      <div style={hotel(170, 250, 330, "#8a3f97")} />
      <div style={hotel(560, 300, 400, "#8a3f97")} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 150 * k, background: "#3d1856" }} />
      {/* Tall enough for their leaves to come out on both sides of the pictures and above them: what is seen of a backdrop is its edges */}
      {palmAt(0, -40, 1900, 0)}
      {palmAt(1, 1120, 1780, 2)}
    </div>
  );
}

