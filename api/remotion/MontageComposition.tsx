import React from "react";
import { AbsoluteFill, Audio, Freeze, Img, Sequence, Series, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import { ResolvedLayer } from "./CuttieComposition";
import IntroCard, { INTRO_W } from "./intro/IntroCard";
import { between, easeOut, introFade, introRate, introSpan, introVolume, isIntro } from "./intro/intros";
import { gainAt, type MusicCurve } from "./music/curve";
import { effectAt, type SegmentEffect } from "./effects";
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
  /** What moves its picture while it plays (see effects.ts) */
  effects?: SegmentEffect[];
}

/** The intro a montage opens with, with all it draws (see ./intro) */
export interface MontageIntro {
  style: string;
  title: string;
  name: string;
  logo: string | null;
  colors: { accent: string; highlight: string; dark: string; light: string };
  font: string;
  /** The channel's follow button: what it says before and after it is pressed */
  follow?: [string, string];
  /** Never set by the renderer: the export mixes the sound in once the video's own is levelled */
  sound?: string;
  gain?: number;
  /** The "hook" intro: the moment of the video it plays first, built like a piece */
  hook?: MontageSegment;
  /** A jingle on the video's music: seconds it holds the screen, a few of the track's beats (absent: as written) */
  hold?: number;
  /** The "hook" intro: the look that frames its moment, by the name of a jingle */
  look?: string;
}

export interface MontageCompositionProps {
  segments: MontageSegment[];
  /** Layers on the montage's own clock (hook line, widgets, section titles) */
  overlays: PlacedLayer[];
  /** A jingle before the first piece: the pieces and the overlays start once it has held the screen */
  intro?: MontageIntro;
  /** Never set by the renderer: the export mixes the music in once the video's own sound is levelled */
  music?: { track: string; curve: MusicCurve; src?: string; from?: number; gain?: number };
  [key: string]: unknown;
}

export const framesOf = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

/** An intro the montage can play: one of the app's, and a hook has its moment */
const playsIntro = (intro: MontageIntro | null | undefined): intro is MontageIntro & { style: Parameters<typeof introSpan>[0] } =>
  !!intro && isIntro(intro.style) && (intro.style !== "hook" || !!intro.hook);

/** The game and the webcam play the same clip: only one of them is heard (the blurred background has no sound) */
function audibleLayerId(layers: Layer[]): string | undefined {
  return layers.find((l) => l.visible && (l.type === "gameplay" || l.type === "facecam") && l.video && !l.video.background)?.id;
}

/** A box of its own for as long as a transition moves the piece: its layers then stack inside it */
const FILL = { position: "absolute", inset: 0, isolation: "isolate" } as const;
/** No box the rest of the time: the layers stack among the overlays as if it was not there */
const BARE = { display: "contents" } as const;

/** A piece's layers, on its clip's clock (`silent`: a picture held still makes no sound) */
/** A layer an effect moves: a picture of the live (the game, the webcam, the blurred backdrop), set straight */
const isPicture = (layer: Layer) => (layer.type === "gameplay" || layer.type === "facecam") && !layer.transform.rotation;

const Layers: React.FC<{ segment: MontageSegment; silent?: boolean; moved?: string }> = ({ segment, silent = false, moved }) => {
  const { fps, width, height } = useVideoConfig();
  const audible = silent ? undefined : audibleLayerId(segment.layers.map((p) => p.layer));
  return (
    <Sequence from={-Math.round(segment.from * fps)} layout="none">
      {segment.layers.map(({ layer, z }) => {
        if (!layer.visible) return null;
        // (each picture moves inside its own box, at its own place in the stack: see the app's MontageComposition)
        const box = layer.transform;
        const on = !!moved && isPicture(layer);
        const clip = `inset(${box.y}px ${width - box.x - box.width}px ${height - box.y - box.height}px ${box.x}px round ${layer.style?.borderRadius ?? 0}px)`;
        return (
          <div key={layer.id} style={on ? { position: "absolute", inset: 0, zIndex: z + 1, clipPath: clip } : BARE}>
            <div style={on ? { position: "absolute", inset: 0, transform: moved, transformOrigin: `${box.x + box.width / 2}px ${box.y + box.height / 2}px` } : BARE}>
              <ResolvedLayer layer={layer} z={z + 1} muted={layer.id !== audible} />
            </div>
          </div>
        );
      })}
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
  // What moves its picture while it plays (a transition has the picture to itself)
  const moved = now ? null : effectAt(segment.effects, frame, fps);
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
        <Layers segment={segment} moved={moved?.transform} />
      </div>
      {now && now.flash > 0 && <div style={{ ...FILL, background: "#fff", opacity: now.flash }} />}
    </>
  );
};

/** The moment a "hook" intro plays, as a piece: the picture punches in on its first frames (what frames it is the intro's to draw) */
const Opener: React.FC<{ segment: MontageSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = 1 + 0.12 * (1 - easeOut(between((frame * 30) / fps, 0, 9)));
  return (
    <div style={{ ...FILL, transform: `scale(${punch})` }}>
      <Layers segment={segment} />
    </div>
  );
};

/** How loud an intro's sound would play here (the renderer never gets one: see MontageIntro.sound) */
const INTRO_VOLUME = 0.5;

/** The intro, above everything: drawn in its own 1080-wide box, brought to the video's size */
const Intro: React.FC<{ intro: MontageIntro }> = ({ intro }) => {
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
};

/**
 * Several pieces one after the other (mirrors the frontend's MontageComposition).
 * Each piece plays its clip from where it was cut: inside it, the clock is the
 * clip's. The hook line and the widgets sit above, on the montage's own clock.
 * An intro holds the screen first: pieces and overlays start after it, and it
 * leaves over the first frames of the first piece.
 */
export const MontageComposition: React.FC<MontageCompositionProps> = ({ segments, overlays, intro, music }) => {
  const { fps } = useVideoConfig();
  const opening = playsIntro(intro) ? introSpan(intro.style, fps, intro.hook?.duration ?? intro.hold) : null;
  return (
    <AbsoluteFill style={{ background: "black", width: 1080, height: 1920 }}>
      <style>{"*, *::before, *::after { box-sizing: border-box; }"}</style>
      <Series>
        {/* Nothing of the video plays while the intro holds the screen (a sequence of a series can't be empty) */}
        {opening && (
          <Series.Sequence durationInFrames={opening.hold}>{intro?.hook ? <Opener segment={intro.hook} /> : <AbsoluteFill />}</Series.Sequence>
        )}
        {segments.map((segment, i) => (
          <Series.Sequence key={i} durationInFrames={framesOf(segment.duration, fps)}>
            <Piece segment={segment} before={segments[i - 1]} next={segments[i + 1]} />
          </Series.Sequence>
        ))}
      </Series>
      {overlays.map(({ layer, z }) =>
        layer.visible ? (
          <Sequence key={layer.id} from={opening?.hold ?? 0} layout="none">
            <ResolvedLayer layer={layer} z={z + 1} />
          </Sequence>
        ) : null
      )}
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
};
