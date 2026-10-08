import { brand, easeOut, FONT, GLASS, HeartGlyph, num, since, text, type KitWidgetProps } from "./shared";

/** The follower count rolling up to its value */
export default function FollowerCount({ props, width, height, currentTime }: KitWidgetProps) {
  const { accent } = brand(props);
  const target = Math.max(0, Math.round(num(props, "followers", 0)));
  const value = Math.round(target * easeOut((since(props, currentTime) - 0.15) / 1.2));
  const font = Math.round(height * 0.46);
  return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ ...GLASS, height, display: "flex", alignItems: "center", gap: height * 0.14, padding: `0 ${height * 0.32}px`, borderRadius: height / 2, whiteSpace: "nowrap" }}>
        <HeartGlyph size={height * 0.46} color={accent} />
        <span style={{ color: "#FFFFFF", fontWeight: 850, fontSize: font, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
          {value.toLocaleString("fr-FR")}
        </span>
        <span style={{ color: "rgba(255,255,255,0.66)", fontWeight: 600, fontSize: font * 0.62 }}>{text(props, "text", "followers")}</span>
      </div>
    </div>
  );
}
