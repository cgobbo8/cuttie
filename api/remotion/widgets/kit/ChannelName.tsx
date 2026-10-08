import { brand, easeOut, FONT, since, text, type KitWidgetProps } from "./shared";

/** The channel's name in big letters, underlined in the channel color */
export default function ChannelName({ props, width, height, currentTime }: KitWidgetProps) {
  const { accent } = brand(props);
  const name = text(props, "displayName", text(props, "login", "streamer"));
  const underline = easeOut((since(props, currentTime) - 0.2) / 0.5);
  const size = Math.round(height * 0.62);
  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: height * 0.06 }}>
      <span
        style={{
          fontFamily: FONT,
          fontWeight: 850,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: "#FFFFFF",
          whiteSpace: "nowrap",
          textShadow: `0 ${size * 0.06}px ${size * 0.25}px rgba(0,0,0,0.55)`,
        }}
      >
        {name}
      </span>
      <span style={{ width: `${Math.round(60 * underline)}%`, height: Math.max(4, height * 0.08), borderRadius: 99, background: accent }} />
    </div>
  );
}
