import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function TextLayer({ layer }: Props) {
  const { text, transform } = layer;
  if (!text) return null;

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        display: "flex",
        alignItems: "center",
        justifyContent:
          text.textAlign === "center" ? "center" :
          text.textAlign === "right" ? "flex-end" : "flex-start",
        padding: "8px 12px",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily: text.fontFamily,
          fontSize: text.fontSize,
          fontWeight: text.fontWeight,
          color: text.color,
          textAlign: text.textAlign,
          textTransform: text.uppercase ? "uppercase" : undefined,
          lineHeight: text.lineHeight,
          width: "100%",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {text.content || "Texte"}
      </span>
    </div>
  );
}
