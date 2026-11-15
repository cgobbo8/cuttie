import { AbsoluteFill, Audio, Freeze, Img, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import IntroCard, { INTRO_W } from "../../lib/intro/IntroCard";
import { introFade, introSpan, introVolume, isIntro } from "../../lib/intro/intros";
import { framesOf, type MontageIntro, type MontageProps, type MontageSegment } from "../../lib/montage";
import { gainAt } from "../../lib/music/curve";
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

/** How loud an intro's sound plays in the page when the clips' own level isn't known. The export sets it against the video's levelled sound instead */
const INTRO_VOLUME = 0.5;

/** The intro, above everything: drawn in its own 1080-wide box, brought to the video's size */
function Intro({ intro }: { intro: MontageIntro }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  if (!isIntro(intro.style)) return null;
  return (
    <AbsoluteFill style={{ zIndex: 100000, pointerEvents: "none" }}>
      <div style={{ transform: `scale(${width / INTRO_W})`, transformOrigin: "0 0" }}>
        <IntroCard id={intro.style} frame={frame} fps={fps} title={intro.title} name={intro.name} logo={intro.logo} colors={intro.colors} font={intro.font} follow={intro.follow} Img={Img} />
      </div>
    </AbsoluteFill>
  );
}

/**
 * Several pieces one after the other (mirrors api/remotion/MontageComposition.tsx).
 * Each piece plays its clip from where it was cut: inside it, the clock is the
 * clip's, so its videos, subtitles and chat need nothing special. The hook
 * line and the widgets sit above, on the montage's own clock. An intro holds
 * the screen first: pieces and overlays start after it, and it leaves over the
 * first frames of the first piece.
 */
export default function MontageComposition({ segments, overlays, intro, music }: MontageProps) {
  const { fps } = useVideoConfig();
  const opening = intro && isIntro(intro.style) ? introSpan(intro.style, fps) : null;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        {/* Nothing of the video plays while the intro holds the screen (a sequence of a series can't be empty) */}
        {opening && (
          <Series.Sequence durationInFrames={opening.hold}>
            <AbsoluteFill />
          </Series.Sequence>
        )}
        {segments.map((segment, i) => (
          // Mounted a second early: the next piece's videos are already at the right frame at the cut
          <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)} premountFor={fps}>
            <Piece segment={segment} before={segments[i - 1]} next={segments[i + 1]} />
          </Series.Sequence>
        ))}
      </Series>
      {overlays.map(({ layer, z }) => (
        <Sequence key={layer.id} from={opening?.hold ?? 0} layout="none">
          <LayerBox layer={layer} z={z + 1} audible={false} />
        </Sequence>
      ))}
      {opening && intro && (
        <Sequence durationInFrames={opening.hold + opening.out} layout="none">
          <Intro intro={intro} />
        </Sequence>
      )}
      {opening && intro?.sound && isIntro(intro.style) && (
        // It fades out as the video starts: a sound longer than its intro doesn't play on over the first words
        <Sequence durationInFrames={opening.hold + introFade(intro.style, fps).frames} layout="none">
          <Audio src={intro.sound} volume={(f) => (intro.gain ?? INTRO_VOLUME) * introVolume(f, intro.style as Parameters<typeof introVolume>[1], fps)} />
        </Sequence>
      )}
      {music?.src && (
        // Under the whole video, started where the track is in full swing, its level following what plays
        <Audio
          src={music.src}
          loop
          loopVolumeCurveBehavior="extend"
          trimBefore={Math.round((music.from ?? 0) * fps)}
          volume={(f) => Math.min(1, (music.gain ?? 1) * gainAt(music.curve, f / fps))}
        />
      )}
    </AbsoluteFill>
  );
}
