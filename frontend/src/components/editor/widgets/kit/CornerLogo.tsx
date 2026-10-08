import { Avatar, brand, text, type KitWidgetProps } from "./shared";

/** A discreet round logo in a corner, like a TV channel bug */
export default function CornerLogo({ props, width, height }: KitWidgetProps) {
  const { light } = brand(props);
  const size = Math.min(width, height);
  return (
    <div style={{ width, height, display: "grid", placeItems: "center", opacity: 0.82 }}>
      <Avatar
        src={text(props, "avatarUrl")}
        size={size}
        light={light}
        round
        style={{ boxShadow: `0 0 0 ${Math.max(2, size * 0.04)}px rgba(255,255,255,0.85), 0 6px 18px rgba(0,0,0,0.4)` }}
      />
    </div>
  );
}
