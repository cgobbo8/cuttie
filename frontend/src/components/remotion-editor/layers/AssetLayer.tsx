import { Img } from "remotion";
import type { Layer } from "../../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function AssetLayer({ layer }: Props) {
  const { asset, transform } = layer;
  if (!asset) return null;

  const isGif = asset.src.toLowerCase().endsWith(".gif");

  const style: React.CSSProperties = {
    width: transform.width,
    height: transform.height,
    objectFit: "fill",
    display: "block",
    maxWidth: "none",
  };

  // Use native <img> for GIFs so the browser animates them
  if (isGif) {
    return <img src={asset.src} alt="" style={style} />;
  }

  return <Img src={asset.src} style={style} />;
}
