import { brand, inkOn, since, text, type KitWidgetProps } from "./shared";

/** A tilted sticker ("CLIP DU JOUR") in the highlight color, wiggling a little */
export default function ClipSticker({ props, width, height, currentTime }: KitWidgetProps) {
  const { highlight, dark } = brand(props);
  const t = Math.max(0, since(props, currentTime));
  const wiggle = Math.sin(t * 3.2) * 1.6;
  const label = text(props, "text", "CLIP DU JOUR");
  return (
    <div style={{ width, height, display: "grid", placeItems: "center" }}>
      <div
        style={{
          padding: `${height * 0.12}px ${height * 0.26}px`,
          background: highlight,
          color: inkOn(highlight) === "#FFFFFF" ? "#FFFFFF" : dark,
          border: `${Math.max(4, height * 0.05)}px solid ${dark}`,
          borderRadius: height * 0.14,
          transform: `rotate(${-6 + wiggle}deg)`,
          boxShadow: `${height * 0.05}px ${height * 0.06}px 0 ${dark}`,
          fontFamily: '"Luckiest Guy", system-ui, sans-serif',
          fontSize: height * 0.36,
          lineHeight: 1,
          whiteSpace: "nowrap",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </div>
    </div>
  );
}
