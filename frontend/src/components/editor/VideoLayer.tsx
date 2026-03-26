import { useCallback, useEffect, useRef, useState } from "react";
import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
}

export default function VideoLayer({ layer, registerVideo }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const { video, transform } = layer;
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!video) return;
    const el = ref.current;
    registerVideo(layer.id, el);
    // Force first frame display
    if (el && el.readyState < 2) {
      el.currentTime = 0;
    }
    // If metadata already cached, grab native size immediately
    if (el && el.videoWidth > 0) {
      setNativeSize({ w: el.videoWidth, h: el.videoHeight });
    }
    return () => registerVideo(layer.id, null);
  }, [layer.id, video, registerVideo]);

  const handleMetadata = useCallback(() => {
    const el = ref.current;
    if (el && el.videoWidth > 0) {
      setNativeSize({ w: el.videoWidth, h: el.videoHeight });
    }
  }, []);

  if (!video) return null;

  const crop = video.crop;

  if (!crop) {
    // No crop — simple fill (gameplay layers)
    return (
      <video
        ref={ref}
        src={video.src}
        muted
        playsInline
        loop
        preload="auto"
        onLoadedMetadata={handleMetadata}
        style={{
          width: transform.width,
          height: transform.height,
          objectFit: "fill",
        }}
      />
    );
  }

  // Crop mode (facecam): render video at native size, then scale+translate
  // so only the crop rect is visible inside the overflow:hidden wrapper.
  const sx = transform.width / crop.w;
  const sy = transform.height / crop.h;
  const ready = nativeSize !== null;

  return (
    <div style={{ width: transform.width, height: transform.height, overflow: "hidden" }}>
      <video
        ref={ref}
        src={video.src}
        muted
        playsInline
        loop
        preload="auto"
        onLoadedMetadata={handleMetadata}
        style={{
          display: "block",
          maxWidth: "none",  // Override Tailwind preflight (max-width: 100%)
          width: ready ? nativeSize.w : undefined,
          height: ready ? nativeSize.h : undefined,
          transformOrigin: "0 0",
          transform: ready
            ? `scale(${sx}, ${sy}) translate(${-crop.x}px, ${-crop.y}px)`
            : undefined,
          visibility: ready ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
