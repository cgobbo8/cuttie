import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
}

export default function AssetLayer({ layer }: Props) {
  const { asset, transform } = layer;
  if (!asset) return null;

  return (
    <img
      src={asset.src}
      alt={layer.name}
      draggable={false}
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
