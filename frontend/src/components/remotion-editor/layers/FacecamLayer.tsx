import { Video } from "remotion";
import type { Layer } from "../../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function FacecamLayer({ layer }: Props) {
  const { video, transform } = layer;
  if (!video) return null;

  const crop = video.crop;

  if (!crop) {
    return (
      <Video
        src={video.src}
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "fill",
        }}
      />
    );
  }

  // Crop mode: scale the video so the crop rect fills the layer
  const sx = transform.width / crop.w;
  const sy = transform.height / crop.h;

  return (
    <div style={{ width: transform.width, height: transform.height, overflow: "hidden" }}>
      <Video
        src={video.src}
        style={{
          display: "block",
          maxWidth: "none",
          transformOrigin: "0 0",
          transform: `scale(${sx}, ${sy}) translate(${-crop.x}px, ${-crop.y}px)`,
        }}
      />
    </div>
  );
}
