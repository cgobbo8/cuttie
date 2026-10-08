import { Video } from "remotion";
import type { Layer } from "../../../lib/editorTypes";

interface Props {
  layer: Layer;
}

/** The clip, whole or cropped to a region (mirrors api/remotion/layers/VideoLayer.tsx) */
export default function GameplayLayer({ layer }: Props) {
  const { video, transform } = layer;
  if (!video) return null;

  if (!video.crop) {
    return (
      <Video
        src={video.src}
        muted
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "fill",
        }}
      />
    );
  }

  const { crop } = video;
  const sx = transform.width / crop.w;
  const sy = transform.height / crop.h;
  return (
    <div style={{ width: transform.width, height: transform.height, overflow: "hidden" }}>
      <Video
        src={video.src}
        muted
        style={{
          display: "block",
          maxWidth: "none",
          width: video.nativeWidth ?? 1920,
          height: video.nativeHeight ?? 1080,
          transformOrigin: "0 0",
          transform: `scale(${sx}, ${sy}) translate(${-crop.x}px, ${-crop.y}px)`,
        }}
      />
    </div>
  );
}
