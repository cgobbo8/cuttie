import { Avatar, brand, easeOut, FONT, since, text, type KitWidgetProps } from "./shared";

/** TV-style lower third: logo, name and the game being played */
export default function LowerThird({ props, width, height, currentTime }: KitWidgetProps) {
  const { accent, light } = brand(props);
  const name = text(props, "displayName", text(props, "login", "streamer"));
  const game = text(props, "game");
  const grow = easeOut((since(props, currentTime) - 0.1) / 0.45);
  const logo = height * 0.7;
  return (
    <div style={{ width, height, display: "flex", alignItems: "center", fontFamily: FONT, position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(10,10,12,0.86) 0%, rgba(10,10,12,0.7) 55%, rgba(10,10,12,0) 100%)",
          borderRadius: height * 0.12,
          clipPath: `inset(0 ${100 - grow * 100}% 0 0)`,
        }}
      />
      <span style={{ position: "relative", width: Math.max(6, height * 0.06), height: height * 0.72 * grow, background: accent, borderRadius: 99, marginLeft: height * 0.14 }} />
      <Avatar src={text(props, "avatarUrl")} size={logo} light={light} style={{ position: "relative", marginLeft: height * 0.14 }} />
      <div style={{ position: "relative", marginLeft: height * 0.16, display: "flex", flexDirection: "column", gap: height * 0.02, opacity: grow }}>
        <span style={{ color: "#FFFFFF", fontWeight: 850, fontSize: height * 0.3, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{name}</span>
        {game && <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 550, fontSize: height * 0.17, whiteSpace: "nowrap" }}>{game}</span>}
      </div>
    </div>
  );
}
