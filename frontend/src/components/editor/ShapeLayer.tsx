import type { Layer } from "../../lib/editorTypes";
import { BOX_SHADOW_PRESETS } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function ShapeLayer({ layer }: Props) {
  const { shape, transform } = layer;
  if (!shape) return null;

  const isCircle = shape.shapeType === "circle";
  const borderRadius = isCircle ? "50%" : (layer.style.borderRadius > 0 ? layer.style.borderRadius : undefined);
  const shadow = BOX_SHADOW_PRESETS[shape.boxShadowPreset]?.value ?? "none";

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        backgroundColor: hexToRgba(shape.backgroundColor, shape.backgroundAlpha),
        borderRadius,
        backdropFilter: shape.backdropBlur > 0 ? `blur(${shape.backdropBlur}px)` : undefined,
        WebkitBackdropFilter: shape.backdropBlur > 0 ? `blur(${shape.backdropBlur}px)` : undefined,
        boxShadow: shadow !== "none" ? shadow : undefined,
      }}
    />
  );
}
