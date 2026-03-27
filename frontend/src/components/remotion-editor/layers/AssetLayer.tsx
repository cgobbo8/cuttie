import { Img } from "remotion";
import type { Layer } from "../../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function AssetLayer({ layer }: Props) {
  const { asset, transform } = layer;
  if (!asset) return null;

  return (
    <Img
      src={asset.src}
      style={{
        width: transform.width,
        height: transform.height,
        objectFit: "fill",
        display: "block",
        maxWidth: "none",
      }}
    />
  );
}
