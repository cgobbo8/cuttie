import React from "react";
import { Img } from "remotion";
import { Gif } from "@remotion/gif";
import type { Layer } from "../editorTypes";

interface Props {
  layer: Layer;
}

export default function AssetLayer({ layer }: Props) {
  const { asset, transform } = layer;
  if (!asset) return null;

  const style: React.CSSProperties = {
    width: transform.width,
    height: transform.height,
    objectFit: "fill" as const,
    display: "block",
  };

  const isGif = asset.src.toLowerCase().endsWith(".gif");

  if (isGif) {
    return (
      <Gif
        src={asset.src}
        width={transform.width}
        height={transform.height}
        fit="fill"
        playbackRate={asset.gifPlaybackRate ?? 1}
      />
    );
  }

  return <Img src={asset.src} style={style} />;
}
