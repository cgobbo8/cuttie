import React from "react";
import { AbsoluteFill, Sequence, Series, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import { ResolvedLayer } from "./CuttieComposition";

/** A layer and where it stacks among all the template's layers (0 = bottom) */
export interface PlacedLayer {
  layer: Layer;
  z: number;
}

/** A piece: `duration` seconds of its clip from `from` (clip seconds) */
export interface MontageSegment {
  from: number;
  duration: number;
  layers: PlacedLayer[];
}

export interface MontageCompositionProps {
  segments: MontageSegment[];
  /** Layers on the montage's own clock (hook line, widgets, section titles) */
  overlays: PlacedLayer[];
  [key: string]: unknown;
}

export const framesOf = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

/** The game and the webcam play the same clip: only one of them is heard (the blurred background has no sound) */
function audibleLayerId(layers: Layer[]): string | undefined {
  return layers.find((l) => l.visible && (l.type === "gameplay" || l.type === "facecam") && l.video && !l.video.background)?.id;
}

/**
 * Several pieces one after the other (mirrors the frontend's MontageComposition).
 * Each piece plays its clip from where it was cut: inside it, the clock is the
 * clip's. The hook line and the widgets sit above, on the montage's own clock.
 */
export const MontageComposition: React.FC<MontageCompositionProps> = ({ segments, overlays }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "black", width: 1080, height: 1920 }}>
      <style>{"*, *::before, *::after { box-sizing: border-box; }"}</style>
      <Series>
        {segments.map((segment, i) => {
          const audible = audibleLayerId(segment.layers.map((p) => p.layer));
          return (
            <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)}>
              <Sequence from={-Math.round(segment.from * fps)} layout="none">
                {segment.layers.map(({ layer, z }) =>
                  layer.visible ? <ResolvedLayer key={layer.id} layer={layer} z={z + 1} muted={layer.id !== audible} /> : null
                )}
              </Sequence>
            </Series.Sequence>
          );
        })}
      </Series>
      {overlays.map(({ layer, z }) => (layer.visible ? <ResolvedLayer key={layer.id} layer={layer} z={z + 1} /> : null))}
    </AbsoluteFill>
  );
};
