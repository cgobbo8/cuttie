import { brand, clamp01, CursorGlyph, easeOut, FONT, HeartGlyph, inkOn, since, text, type KitWidgetProps } from "./shared";

/** A "Suivre" button that a cursor comes and clicks, then little hearts float up */
export default function FollowButton({ props, width, height, currentTime }: KitWidgetProps) {
  const { accent } = brand(props);
  const ink = inkOn(accent);
  const t = since(props, currentTime);
  const clickAt = 0.9;
  const followed = t >= clickAt;
  const press = t >= clickAt - 0.08 && t < clickAt + 0.12 ? 0.92 : 1;
  const font = Math.round(height * 0.34);
  const btnH = height * 0.72;
  const btnW = Math.min(width * 0.86, btnH * 3.6);

  // Cursor: slides in from the bottom right, stays a moment, leaves
  const approach = easeOut(t / clickAt);
  const leave = easeOut((t - clickAt - 0.35) / 0.5);
  const cursorX = width / 2 + btnW * 0.18 + (1 - approach) * width * 0.4 + leave * width * 0.3;
  const cursorY = height / 2 + (1 - approach) * height * 0.9 + leave * height * 0.6;
  const cursorOpacity = clamp01(t / 0.2) * (1 - clamp01((t - clickAt - 0.4) / 0.4));

  return (
    <div style={{ width, height, position: "relative", display: "grid", placeItems: "center", fontFamily: FONT }}>
      <div
        style={{
          width: btnW,
          height: btnH,
          borderRadius: btnH * 0.28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: btnH * 0.16,
          background: followed ? "rgba(12,12,14,0.78)" : accent,
          color: followed ? "#FFFFFF" : ink,
          fontWeight: 800,
          fontSize: font,
          transform: `scale(${press})`,
          boxShadow: followed ? "inset 0 0 0 2px rgba(255,255,255,0.25)" : `0 14px 34px ${accent}66`,
          whiteSpace: "nowrap",
        }}
      >
        <HeartGlyph size={font * 1.15} color={followed ? accent : ink} filled={followed} />
        {followed ? text(props, "doneText", "Suivi") : text(props, "text", "Suivre")}
      </div>

      {/* Hearts floating up after the click */}
      {[0, 1, 2].map((i) => {
        const h = t - clickAt - i * 0.12;
        if (h < 0 || h > 1.1) return null;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: width / 2 + (i - 1) * btnW * 0.22,
              top: height / 2 - btnH * 0.4 - h * height * 0.9,
              opacity: 1 - h / 1.1,
              transform: `scale(${0.6 + h * 0.5}) rotate(${(i - 1) * 14}deg)`,
            }}
          >
            <HeartGlyph size={font} color={accent} />
          </span>
        );
      })}

      <span style={{ position: "absolute", left: cursorX, top: cursorY, opacity: cursorOpacity, transform: `scale(${press < 1 ? 0.88 : 1})` }}>
        <CursorGlyph size={height * 0.42} />
      </span>
    </div>
  );
}
