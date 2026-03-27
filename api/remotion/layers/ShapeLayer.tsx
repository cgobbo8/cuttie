import React from "react";
import type { Layer } from "../editorTypes";
import { BOX_SHADOW_PRESETS } from "../editorTypes";

interface Props {
  layer: Layer;
}

export default function ShapeLayer({ layer }: Props) {
  const { shape, transform } = layer;
  if (!shape) return null;

  const { r, g, b } = hexToRgbObj(shape.backgroundColor);
  const bg = `rgba(${r},${g},${b},${shape.backgroundAlpha})`;
  const boxShadow = BOX_SHADOW_PRESETS[shape.boxShadowPreset]?.value ?? "none";
  const isCircle = shape.shapeType === "circle";

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        background: bg,
        backdropFilter: shape.backdropBlur > 0 ? `blur(${shape.backdropBlur}px)` : undefined,
        borderRadius: isCircle ? "50%" : undefined,
        boxShadow: boxShadow !== "none" ? boxShadow : undefined,
      }}
    />
  );
}

function hexToRgbObj(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
