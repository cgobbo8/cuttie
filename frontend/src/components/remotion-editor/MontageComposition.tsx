import { AbsoluteFill, Sequence, Series, useVideoConfig } from "remotion";
import { framesOf, type MontageProps } from "../../lib/montage";
import { audibleLayerId, LayerBox } from "./CuttieComposition";

/**
 * Several pieces one after the other (mirrors api/remotion/MontageComposition.tsx).
 * Each piece plays its clip from where it was cut: inside it, the clock is the
 * clip's, so its videos, subtitles and chat need nothing special. The hook
 * line and the widgets sit above, on the montage's own clock.
 */
export default function MontageComposition({ segments, overlays }: MontageProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        {segments.map((segment, i) => {
          const layers = segment.layers.map((p) => p.layer);
          const audible = audibleLayerId(layers);
          return (
            // Mounted a second early: the next piece's videos are already at the right frame at the cut
            <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)} premountFor={fps}>
              <Sequence from={-Math.round(segment.from * fps)} layout="none">
                {segment.layers.map(({ layer, z }) => (
                  <LayerBox key={layer.id} layer={layer} z={z + 1} audible={layer.id === audible} />
                ))}
              </Sequence>
            </Series.Sequence>
          );
        })}
      </Series>
      {overlays.map(({ layer, z }) => (
        <LayerBox key={layer.id} layer={layer} z={z + 1} audible={false} />
      ))}
    </AbsoluteFill>
  );
}
