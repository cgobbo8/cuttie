import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "../../lib/editorTypes";
import GameplayLayer from "./layers/GameplayLayer";
import FacecamLayer from "./layers/FacecamLayer";
import SubtitleLayer from "./layers/SubtitleLayer";
import ShapeLayer from "./layers/ShapeLayer";
import AssetLayer from "./layers/AssetLayer";

export interface CuttieCompositionProps {
  layers: Layer[];
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case "gameplay": return <GameplayLayer layer={layer} />;
    case "facecam":  return <FacecamLayer layer={layer} />;
    case "subtitles": return <SubtitleLayer layer={layer} />;
    case "shape":    return <ShapeLayer layer={layer} />;
    case "asset":    return <AssetLayer layer={layer} />;
    default:         return null;
  }
}

/**
 * Animated wrapper — same fade-in/fade-out logic as NativePreviewViewport.animatedOpacity()
 * but using Remotion's interpolate + useCurrentFrame for frame-accurate export rendering.
 */
function AnimatedLayerWrapper({ layer, children }: { layer: Layer; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { style } = layer;

  const fadeInFrames = style.fadeIn * fps;
  const fadeOutFrames = style.fadeOut * fps;

  let opacity = style.opacity;
  if (fadeInFrames > 0) {
    opacity = interpolate(frame, [0, fadeInFrames], [0, opacity], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (fadeOutFrames > 0) {
    opacity = interpolate(
      frame,
      [durationInFrames - fadeOutFrames, durationInFrames],
      [opacity, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        opacity,
        borderRadius: !layer.shape && style.borderRadius > 0 ? style.borderRadius : undefined,
        overflow: !layer.shape && style.borderRadius > 0 ? "hidden" : undefined,
        filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

export default function CuttieComposition({ layers }: CuttieCompositionProps) {
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {layers.map((layer) => {
        if (!layer.visible) return null;
        return (
          <div
            key={layer.id}
            style={{
              position: "absolute",
              left: layer.transform.x,
              top: layer.transform.y,
              width: layer.transform.width,
              height: layer.transform.height,
            }}
          >
            <AnimatedLayerWrapper layer={layer}>
              <LayerContent layer={layer} />
            </AnimatedLayerWrapper>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
