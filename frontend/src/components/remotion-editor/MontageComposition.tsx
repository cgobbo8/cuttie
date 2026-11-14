import { AbsoluteFill, Freeze, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import { framesOf, type MontageProps, type MontageSegment } from "../../lib/montage";
import { isTransition, lookStyle, transitionAt } from "../../lib/transitions";
import { audibleLayerId, LayerBox } from "./CuttieComposition";

/** A box of its own for as long as a transition moves the piece: its layers then stack inside it */
const FILL = { position: "absolute", inset: 0, isolation: "isolate" } as const;
/** No box the rest of the time: the layers stack among the overlays as if it was not there */
const BARE = { display: "contents" } as const;

/** A piece's layers, on its clip's clock (`silent`: a picture held still makes no sound) */
function Layers({ segment, silent = false }: { segment: MontageSegment; silent?: boolean }) {
  const { fps } = useVideoConfig();
  const audible = silent ? undefined : audibleLayerId(segment.layers.map((p) => p.layer));
  return (
    <Sequence from={-Math.round(segment.from * fps)} layout="none">
      {segment.layers.map(({ layer, z }) => (
        <LayerBox key={layer.id} layer={layer} z={z + 1} audible={layer.id === audible} />
      ))}
    </Sequence>
  );
}

/**
 * One piece and what the transitions do to it: the one it comes in with plays
 * on its first frames (over the last picture of the piece before, held still,
 * when the transition shows both), the next piece's on its last frames.
 */
function Piece({ segment, before, next }: { segment: MontageSegment; before?: MontageSegment; next?: MontageSegment }) {
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
}

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
        {segments.map((segment, i) => (
          // Mounted a second early: the next piece's videos are already at the right frame at the cut
          <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)} premountFor={fps}>
            <Piece segment={segment} before={segments[i - 1]} next={segments[i + 1]} />
          </Series.Sequence>
        ))}
      </Series>
      {overlays.map(({ layer, z }) => (
        <LayerBox key={layer.id} layer={layer} z={z + 1} audible={false} />
      ))}
    </AbsoluteFill>
  );
}
