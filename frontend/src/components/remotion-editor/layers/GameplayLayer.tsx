import { Video } from "remotion";
import type { Layer } from "../../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function GameplayLayer({ layer }: Props) {
  if (!layer.video) return null;

  return (
    <Video
      src={layer.video.src}
      muted
      style={{
        width: layer.transform.width,
        height: layer.transform.height,
        objectFit: "fill",
      }}
    />
  );
}
