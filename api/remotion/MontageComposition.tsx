import React from "react";
import { AbsoluteFill, Freeze, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import { ResolvedLayer } from "./CuttieComposition";
import { isTransition, lookStyle, transitionAt } from "./transitions";

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
  /** The ready-made transition it comes in with (see transitions.ts) */
  transition?: string;
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

/** A box of its own for as long as a transition moves the piece: its layers then stack inside it */
const FILL = { position: "absolute", inset: 0, isolation: "isolate" } as const;
/** No box the rest of the time: the layers stack among the overlays as if it was not there */
const BARE = { display: "contents" } as const;

/** A piece's layers, on its clip's clock (`silent`: a picture held still makes no sound) */
const Layers: React.FC<{ segment: MontageSegment; silent?: boolean }> = ({ segment, silent = false }) => {
  const { fps } = useVideoConfig();
  const audible = silent ? undefined : audibleLayerId(segment.layers.map((p) => p.layer));
  return (
    <Sequence from={-Math.round(segment.from * fps)} layout="none">
      {segment.layers.map(({ layer, z }) =>
        layer.visible ? <ResolvedLayer key={layer.id} layer={layer} z={z + 1} muted={layer.id !== audible} /> : null
      )}
    </Sequence>
  );
};

/**
 * One piece and what the transitions do to it: the one it comes in with plays
 * on its first frames (over the last picture of the piece before, held still,
 * when the transition shows both), the next piece's on its last frames.
 */
const Piece: React.FC<{ segment: MontageSegment; before?: MontageSegment; next?: MontageSegment }> = ({ segment, before, next }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const coming = isTransition(segment.transition) ? transitionAt(segment.transition, frame, fps) : null;
  const going = !coming && isTransition(next?.transition) ? transitionAt(next.transition, frame - framesOf(segment.duration, fps), fps) : null;
  const now = coming ?? going;
  return (
    <>
      {coming?.held && before && (
        <div style={{ ...FILL, ...lookStyle(coming.held, width) }}>
          <Freeze frame={framesOf(before.duration, fps) - 1}>
            <Layers segment={before} silent />
          </Freeze>
        </div>
      )}
      <div style={now ? { ...FILL, ...lookStyle(now.piece, width) } : BARE}>
        <Layers segment={segment} />
      </div>
      {now && now.flash > 0 && <div style={{ ...FILL, background: "#fff", opacity: now.flash }} />}
    </>
  );
};

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
        {segments.map((segment, i) => (
          <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)}>
            <Piece segment={segment} before={segments[i - 1]} next={segments[i + 1]} />
          </Series.Sequence>
        ))}
      </Series>
      {overlays.map(({ layer, z }) => (layer.visible ? <ResolvedLayer key={layer.id} layer={layer} z={z + 1} /> : null))}
    </AbsoluteFill>
  );
};
