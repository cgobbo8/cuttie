import React from "react";
import type { Layer } from "../editorTypes";
import { BOX_SHADOW_PRESETS } from "../editorTypes";

interface Props {
  layer: Layer;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
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
