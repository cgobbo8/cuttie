import { useEffect, useRef } from "react";
import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
}

export default function VideoLayer({ layer, registerVideo }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const { video, transform } = layer;
  if (!video) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    registerVideo(layer.id, ref.current);
    return () => registerVideo(layer.id, null);
  }, [layer.id, registerVideo]);

  return (
    <video
      ref={ref}
      src={video.src}
      muted
      playsInline
      loop
      style={{
        width: transform.width,
        height: transform.height,
        objectFit: "fill",
      }}
    />
  );
}
