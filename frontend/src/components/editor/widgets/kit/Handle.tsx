import { brand, FONT, GLASS, text, TwitchGlyph, type KitWidgetProps } from "./shared";

/** twitch.tv/<login> on a dark glass pill */
export default function Handle({ props, width, height }: KitWidgetProps) {
  const { accent } = brand(props);
  const login = text(props, "login", "streamer");
  const font = Math.round(height * 0.4);
  return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          ...GLASS,
          height,
          display: "flex",
          alignItems: "center",
          gap: height * 0.16,
          padding: `0 ${height * 0.34}px 0 ${height * 0.26}px`,
          borderRadius: height / 2,
          whiteSpace: "nowrap",
          fontFamily: FONT,
          fontSize: font,
        }}
      >
        <TwitchGlyph size={height * 0.5} color={accent} />
        <span style={{ color: "rgba(255,255,255,0.62)", fontWeight: 500 }}>
          twitch.tv/<span style={{ color: "#FFFFFF", fontWeight: 800 }}>{login}</span>
        </span>
      </div>
    </div>
  );
}
