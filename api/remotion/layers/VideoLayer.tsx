import React from "react";
import { OffthreadVideo } from "remotion";
import type { Layer } from "../editorTypes";

interface Props {
  layer: Layer;
}

export default function VideoLayer({ layer }: Props) {
  const { video, transform } = layer;
  if (!video) return null;

  const crop = video.crop;

  if (!crop) {
    return (
      <OffthreadVideo
        src={video.src}
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "fill",
        }}
      />
    );
  }

  // Crop mode (facecam): use native dimensions to scale+translate
  const nw = video.nativeWidth ?? 1920;
  const nh = video.nativeHeight ?? 1080;
  const sx = transform.width / crop.w;
  const sy = transform.height / crop.h;

  return (
    <div style={{ width: transform.width, height: transform.height, overflow: "hidden" }}>
      <OffthreadVideo
        src={video.src}
        style={{
          display: "block",
          width: nw,
          height: nh,
          transformOrigin: "0 0",
          transform: `scale(${sx}, ${sy}) translate(${-crop.x}px, ${-crop.y}px)`,
        }}
      />
    </div>
  );
}
