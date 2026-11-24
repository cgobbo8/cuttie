import { AbsoluteFill, Audio, Freeze, Img, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import IntroCard, { INTRO_W } from "../../lib/intro/IntroCard";
import { between, easeOut, introFade, introRate, introSpan, introVolume, isIntro } from "../../lib/intro/intros";
import { framesOf, playsIntro, type MontageIntro, type MontageProps, type MontageSegment } from "../../lib/montage";
import { effectAt } from "../../lib/effects";
import { gainAt } from "../../lib/music/curve";
import { isTransition, lookStyle, transitionAt } from "../../lib/transitions";
import { audibleLayerId, LayerBox } from "./CuttieComposition";

/** A box of its own for as long as a transition moves the piece: its layers then stack inside it */
const FILL = { position: "absolute", inset: 0, isolation: "isolate" } as const;
/** No box the rest of the time: the layers stack among the overlays as if it was not there */
const BARE = { display: "contents" } as const;

/** What an effect does right now to a piece's webcam and to its other pictures (a move can be the webcam's alone) */
type Moved = { cam?: string; game?: string };

/** A layer an effect moves: a picture of the live (the game, the webcam, the blurred backdrop), set straight */
const isPicture = (layer: MontageSegment["layers"][number]["layer"]) => (layer.type === "gameplay" || layer.type === "facecam") && !layer.transform.rotation;

/**
 * A piece's layers, on its clip's clock (`silent`: a picture held still makes no sound).
 * `moved`: what an effect does to the picture right now. Each picture moves INSIDE its own box, which
 * stays where it is (clipped to it, around its own centre): a frame a layout draws round a picture, the
 * subtitles and the titles don't move. Moved as one box, the piece went under what a layout draws
 * between its layers (the GTA layout's frames) and came out black on a real export; moved whole, each
 * picture grew out of its frame. The boxes are always there (no box at all while nothing moves): a
 * layer is never mounted again when an effect starts or ends, which would restart its video in the preview.
 */
function Layers({ segment, silent = false, moved }: { segment: MontageSegment; silent?: boolean; moved?: Moved }) {
  const { fps, width, height } = useVideoConfig();
  const audible = silent ? undefined : audibleLayerId(segment.layers.map((p) => p.layer));
  return (
    <Sequence from={-Math.round(segment.from * fps)} layout="none">
      {segment.layers.map(({ layer, z }) => {
        const box = layer.transform;
        // (a move made for the webcam, the face, leaves the game alone: each picture has its own)
        const transform = isPicture(layer) ? (layer.type === "facecam" ? moved?.cam : moved?.game) : undefined;
        const on = !!transform;
        const clip = `inset(${box.y}px ${width - box.x - box.width}px ${height - box.y - box.height}px ${box.x}px round ${layer.style?.borderRadius ?? 0}px)`;
        return (
          <div key={layer.id} style={on ? { position: "absolute", inset: 0, zIndex: z + 1, clipPath: clip } : BARE}>
            <div style={on ? { position: "absolute", inset: 0, transform, transformOrigin: `${box.x + box.width / 2}px ${box.y + box.height * (layer.type === "facecam" ? 0.42 : 0.5)}px` } : BARE}>
              <LayerBox layer={layer} z={z + 1} audible={layer.id === audible} />
            </div>
          </div>
        );
      })}
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
  // What moves its picture while it plays (a transition has the picture to itself)
  const hasCam = segment.layers.some(({ layer }) => layer.type === "facecam" && isPicture(layer));
  const moved: Moved | undefined = now ? undefined : { cam: effectAt(segment.effects, frame, fps, "cam")?.transform, game: effectAt(segment.effects, frame, fps, hasCam ? "game" : "all")?.transform };
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
        <Layers segment={segment} moved={moved} />
      </div>
      {now && now.flash > 0 && <div style={{ ...FILL, background: "#fff", opacity: now.flash }} />}
    </>
  );
}

/** The moment a "hook" intro plays, as a piece: the picture punches in on its first frames (what frames it is the intro's to draw) */
function Opener({ segment }: { segment: MontageSegment }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = 1 + 0.12 * (1 - easeOut(between((frame * 30) / fps, 0, 9)));
  return (
    <div style={{ ...FILL, transform: `scale(${punch})` }}>
      <Layers segment={segment} />
    </div>
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
        <IntroCard
          id={intro.style}
          frame={frame}
          fps={fps}
          title={intro.title}
          name={intro.name}
          logo={intro.logo}
          colors={intro.colors}
          font={intro.font}
          follow={intro.follow}
          // A hook's moment plays underneath, for as long as it lasts; a jingle on a music lasts a few of its beats
          over={!!intro.hook}
          hold={intro.hook ? framesOf(intro.hook.duration, fps) : intro.hold ? introSpan(intro.style, fps, intro.hold).hold : undefined}
          look={intro.look}
          Img={Img}
        />
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
 * first frames of the first piece. A "hook" intro plays a moment of the video
 * meanwhile, as a piece of its own.
 */
export default function MontageComposition({ segments, overlays, intro, music }: MontageProps) {
  const { fps } = useVideoConfig();
  const opening = playsIntro(intro) ? introSpan(intro.style, fps, intro.hook?.duration ?? intro.hold) : null;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        {/* Nothing of the video plays while the intro holds the screen (a sequence of a series can't be empty), but the moment of a hook */}
        {opening && (
          <Series.Sequence durationInFrames={opening.hold}>{intro?.hook ? <Opener segment={intro.hook} /> : <AbsoluteFill />}</Series.Sequence>
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
        // (a jingle that follows the music plays faster or slower, and its sound with it: its hits stay on what lands)
        <Sequence durationInFrames={opening.hold + introFade(intro.style, fps, intro.hold).frames} layout="none">
          <Audio src={intro.sound} playbackRate={introRate(intro.style, intro.hold)} volume={(f) => (intro.gain ?? INTRO_VOLUME) * introVolume(f, intro.style as Parameters<typeof introVolume>[1], fps, intro.hold)} />
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
