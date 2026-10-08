import { Avatar, brand, FONT, GLASS, HeartGlyph, inkOn, text, type KitWidgetProps } from "./shared";

/** "Suis-moi sur Twitch": logo, name and a follow button on a glass card */
export default function FollowBanner({ props, width, height }: KitWidgetProps) {
  const { accent, light } = brand(props);
  const name = text(props, "displayName", text(props, "login", "streamer"));
  const pad = height * 0.14;
  const logo = height - pad * 2;
  return (
    <div
      style={{
        ...GLASS,
        width,
        height,
        borderRadius: height * 0.24,
        display: "flex",
        alignItems: "center",
        gap: pad,
        padding: pad,
        fontFamily: FONT,
        borderLeft: `${Math.max(4, height * 0.035)}px solid ${accent}`,
      }}
    >
      <Avatar src={text(props, "avatarUrl")} size={logo} light={light} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: height * 0.03 }}>
        <span style={{ color: accent, fontWeight: 700, fontSize: height * 0.15, whiteSpace: "nowrap" }}>{text(props, "text", "Suis-moi sur Twitch")}</span>
        <span
          style={{
            color: "#FFFFFF",
            fontWeight: 850,
            fontSize: height * 0.26,
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
      </div>
      <div
        style={{
          flex: "none",
          height: height * 0.36,
          padding: `0 ${height * 0.16}px`,
          borderRadius: height * 0.1,
          display: "flex",
          alignItems: "center",
          gap: height * 0.06,
          background: accent,
          color: inkOn(accent),
          fontWeight: 800,
          fontSize: height * 0.15,
        }}
      >
        <HeartGlyph size={height * 0.17} color={inkOn(accent)} />
        Suivre
      </div>
    </div>
  );
}
