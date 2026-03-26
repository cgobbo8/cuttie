import { useEffect, useRef } from "react";
import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
  clipWidth: number;
  clipHeight: number;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
}

export default function VideoLayer({ layer, clipWidth, clipHeight, registerVideo }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const { video, transform } = layer;
  if (!video) return null;

  const { src, crop, blur, brightness, borderRadius } = video;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    registerVideo(layer.id, ref.current);
    return () => registerVideo(layer.id, null);
  }, [layer.id, registerVideo]);

  // No crop: fill the layer bounds entirely (e.g., blurred background)
  if (!crop) {
    const filters: string[] = [];
    if (blur) filters.push(`blur(${blur}px)`);
    if (brightness != null && brightness !== 1) filters.push(`brightness(${brightness})`);

    return (
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        loop
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "cover",
          filter: filters.length > 0 ? filters.join(" ") : undefined,
          borderRadius: borderRadius ? `${borderRadius}px` : undefined,
        }}
      />
    );
  }

  // Cropped: scale source so that crop region fills the layer bounds
  const scaleX = transform.width / crop.w;
  const scaleY = transform.height / crop.h;

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        overflow: "hidden",
        borderRadius: borderRadius ? `${borderRadius}px` : undefined,
      }}
    >
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        loop
        style={{
          position: "absolute",
          left: -crop.x * scaleX,
          top: -crop.y * scaleY,
          width: clipWidth * scaleX,
          height: clipHeight * scaleY,
        }}
      />
    </div>
  );
}
