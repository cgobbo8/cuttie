import React from "react";
import { Img, OffthreadVideo } from "remotion";
import type { Layer } from "../editorTypes";

interface Props {
  layer: Layer;
}

export default function AssetLayer({ layer }: Props) {
  const { asset, transform } = layer;
  if (!asset) return null;

  // GIF assets are pre-converted to WebM (VP9 + alpha) by the render service
  if (asset.gifVideoSrc) {
    return (
      <OffthreadVideo
        src={asset.gifVideoSrc}
        transparent
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "fill",
        }}
      />
    );
  }

  return (
    <Img
      src={asset.src}
      style={{
        width: transform.width,
        height: transform.height,
        objectFit: "fill",
        display: "block",
      }}
    />
  );
}
