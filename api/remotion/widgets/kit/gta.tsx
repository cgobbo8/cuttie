/**
 * The widgets of the GTA pack: an evening in Vice City. Drawn with the pack's own colours and
 * lettering whatever the channel's are (see lib/intro/IntroCard.tsx, which opens a video the same
 * way). Nothing here is taken from the game: no logo, no artwork, no font of its publisher.
 */
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

