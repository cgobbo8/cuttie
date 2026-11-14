import React from "react";
import { OffthreadVideo, useRemotionEnvironment } from "remotion";
import { Video } from "@remotion/media";
import type { Layer } from "../editorTypes";

interface Props {
  layer: Layer;
  /** No sound from this video (montages: the game and the webcam play the same clip, one of them is heard) */
  muted?: boolean;
}

/**
 * <Video> from @remotion/media decodes frames with WebCodecs inside the page —
 * Remotion's fastest path for rendering (OffthreadVideo round-trips every frame
 * through its compositor). The editor preview keeps OffthreadVideo.
 */
function ClipVideo({ src, style, muted }: { src: string; style: React.CSSProperties; muted?: boolean }) {
  const { isRendering } = useRemotionEnvironment();
  return isRendering ? <Video src={src} style={style} muted={muted} /> : <OffthreadVideo src={src} style={style} muted={muted} />;
}

export default function VideoLayer({ layer, muted }: Props) {
  const { video, transform } = layer;
  if (!video) return null;

  const crop = video.crop;

  if (!crop) {
    return (
      <ClipVideo
        src={video.src}
        muted={muted}
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
      <ClipVideo
        src={video.src}
        muted={muted}
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
