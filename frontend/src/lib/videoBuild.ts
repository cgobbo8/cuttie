import type { TFunction } from "i18next";
import type { BrandKit, Compilation, CompilationItem, EditEnvironment, PieceState, TwitchChannel } from "./api";
import { allItems, hookMoment, hookStart, sectionStarts, transitionsOf } from "./compilation";
import { isEffectLevel } from "./effects";
import { fontFamily } from "./fonts";
import { buildMontage, renderIntro, renderPieces, withEffects, type MontageCut, type MontageProps, type MontageSegment } from "./montage";
import { trackOf } from "./music/library";
import type { MusicTrack } from "./music/mix";
import { introOf, montageIntro, montageMusic, type SoundPiece } from "./music/sound";
import { clipTemplateContext } from "./templateContext";
import { buildAny, defaultTemplateKey, findCustom, hookOf, isBuiltIn, type TemplateKey } from "./templateKeys";
import { isHookStyle, titleCard, type TemplateSpec } from "./templateSpec";

/**
 * A video as Remotion plays it, built from its passages and its look: what the montage shows
 * (the preview) and what an export is asked with. The same for a clip, a sequence and a
 * compilation; no screen needed, so several videos can be exported one after the other.
 */

export const FPS = 30;
/** A section's title stays this long on screen, seconds (less in a short section) */
export const TITLE_SECONDS = 2.2;

/** A passage's clip, and the live it is in (a compilation may take passages from several) */
export type Piece = PieceState & { job: string };

/** The item's clip is there and covers the moment as it is now */
export function covers<P extends PieceState>(piece: P | undefined, item: CompilationItem): piece is P & { file_start: number; file_end: number } {
  return !!piece?.ready && piece.file_start != null && piece.file_end != null && piece.file_start <= item.start + 0.05 && piece.file_end >= item.end - 0.05;
}

export const pieceVersion = (piece: PieceState) => `${piece.file}@${piece.file_start}-${piece.file_end}`;

/** What every video of a live is built with: the channel's kit, its templates, the live's game, the musics */
export interface BuildWith {
  jobId: string;
  kit: BrandKit;
  channel: TwitchChannel | null;
  customs: TemplateSpec[];
  /** The live's game (what its widgets show) */
  game: string | null;
  musics: MusicTrack[];
  t: TFunction;
}

export interface BuiltVideo {
  montage: MontageProps;
  /** Each passage's clip, the live it is in when it isn't the video's own, and its id, in playing order */
  files: string[];
  jobs: (string | undefined)[];
  ids: string[];
  /** The clip a "hook" opening plays */
  opener?: { file: string; job?: string };
}

/** The template a video is shown in: its own when it is one that exists, else the channel's default */
export function templateOf(video: Pick<Compilation, "template"> | null | undefined, kit: BrandKit, customs: TemplateSpec[]): TemplateKey {
  return video?.template && (isBuiltIn(video.template) || findCustom(video.template, customs)) ? video.template : defaultTemplateKey(kit, customs);
}

/**
 * What Remotion plays for these items (all with their clip and its data), null when something is
 * missing. `all`: the whole video, when only what is ready of it is built (`source`).
 */
export function buildVideo({ jobId, kit, channel, customs, game, musics, t }: BuildWith, source: Compilation, states: Record<string, Piece>, known: Record<string, EditEnvironment>, all: Compilation = source): BuiltVideo | null {
  const templateKey = templateOf(all, kit, customs);
    const items = allItems(source);
    // How each passage comes in (`all`: the whole video, when only what is ready of it is built)
    const transitions = transitionsOf(all);
    const cuts: MontageCut[] = [];
    const files: string[] = [];
    // The live each clip is in, when it isn't this one
    const jobs: (string | undefined)[] = [];
    // Each passage in its own template when it has one, else the video's
    const keys = items.map((item) => (item.template && (isBuiltIn(item.template) || findCustom(item.template, customs)) ? item.template : templateKey));
    // How the video writes its titles, when it says so (else each template writes them its own way)
    const written = isHookStyle(all.titleStyle) ? all.titleStyle : null;
    for (const item of items) {
      const piece = states[item.id];
      const env = piece && known[pieceVersion(piece)];
      if (!covers(piece, item) || !env) return null;
      const ctx = clipTemplateContext({
        jobId: piece.job,
        filename: piece.file,
        env,
        kit,
        login: channel?.login ?? kit.twitch_login,
        avatarUrl: channel?.avatar_url ?? null,
        facecam: env.facecam,
        startAt: 0,
        endAt: 1,
        // With titles, each section's title is the hook of its part
        hook: source.titles ? "" : source.hook.trim() || source.name,
      });
      cuts.push({
        ctx: { ...ctx, displayName: channel?.display_name ?? null, followers: channel?.followers ?? null, game },
        start: item.start - piece.file_start,
        end: item.end - piece.file_start,
        transition: transitions[item.id],
      });
      files.push(piece.file);
      jobs.push(piece.job !== jobId ? piece.job : undefined);
    }
    if (cuts.length === 0) return null;
    // Where each part starts in the list of passages
    const firstOf = new Map<string, number>();
    let before = 0;
    for (const s of source.sections) {
      if (s.items.length > 0) firstOf.set(s.id, before);
      before += s.items.length;
    }
    const montage = buildMontage(
      cuts,
      (c, index) => buildAny(index >= 0 ? keys[index] : templateKey, c, customs, written),
      FPS,
      (total) =>
        source.titles
          ? sectionStarts(source)
              // (a part whose title is hidden keeps it in the list, not in the video)
              .filter((s) => s.title.trim() && !s.hidden)
              .flatMap((s) => {
                // A part's title is written as the template of its first passage writes its hook, where it puts it
                const index = firstOf.get(s.id) ?? 0;
                const ctx = cuts[index].ctx;
                return titleCard(ctx, hookOf(keys[index], ctx, customs, written), s.title.trim(), s.at, Math.min(total, s.at + Math.min(TITLE_SECONDS, s.length * 0.7)), s.id);
              })
          : [],
    );
    // What moves the picture on what is said (a zoom from one passage to the next, a punch on a line that lands), when the video asks for it
    montage.segments = withEffects(montage, cuts, isEffectLevel(all.effects) ? all.effects : null).segments;
    // A "hook" intro plays a moment of the video first: built like a piece, in that passage's own template, the
    // video's title written on it as the template writes its hook (where it puts it: never on the face)
    const moment = hookMoment(all);
    const hookAt = moment ? items.findIndex((item) => item.id === moment.item.id) : -1;
    let opener: { segment: MontageSegment; file: string; job?: string; sound: SoundPiece } | null = null;
    const hookPiece = moment ? states[moment.item.id] : undefined;
    if (moment && hookAt >= 0 && covers(hookPiece, moment.item)) {
      const piece = hookPiece;
      const { ctx, start: floor } = cuts[hookAt];
      const raw = moment.start - piece.file_start;
      // Cut out of a longer passage by the app: it starts on a word, not inside one
      const start = moment.auto && raw > floor + 0.05 ? hookStart(ctx.words, raw, floor) : raw;
      const end = moment.end - piece.file_start;
      const [segment] = buildMontage([{ ctx, start, end }], (c) => buildAny(keys[hookAt], c, customs, written), FPS).segments;
      const top = Math.max(0, ...segment.layers.map((p) => p.z)) + 1;
      // (there on the very first picture, the video's cover, and until the cut to the video: no entrance, no exit of its own)
      const cover = titleCard(ctx, hookOf(keys[hookAt], ctx, customs, written), all.intro?.title?.trim() || all.name, 0, segment.from + segment.duration + 1, "hook");
      opener = {
        segment: { ...segment, layers: [...segment.layers, ...cover.map((layer, i) => ({ layer, z: top + i }))] },
        file: piece.file,
        ...(piece.job !== jobId ? { job: piece.job } : {}),
        sound: { words: ctx.words, start, end, said: !!moment.item.text.trim() },
      };
    }
    // What the video opens with: a jingle (the channel's logo and colours, its title written as the video's titles are), or its hook
    const first = cuts[0].ctx;
    const intro = montageIntro(
      all.intro,
      {
        title: all.name,
        name: first.displayName ?? first.login ?? "",
        logo: first.avatarUrl,
        colors: first.colors,
        font: fontFamily(hookOf(templateKey, first, customs, written).font),
        follow: [t("compilation.intro.followLabel"), t("compilation.intro.followDone")],
      },
      opener?.segment,
      // On a music, a jingle lasts a few of its beats: the video starts on one
      trackOf(musics, all.music?.track)?.bpm,
    );
    if (intro) montage.intro = intro;
    // The music under the video: lower where people talk, more present where the game plays alone
    const track = trackOf(musics, all.music?.track);
    if (track && all.music) {
      // A clip that was never transcribed has no words: what is said in it counts as talk, not as silence
      const pieces = cuts.map((cut, i) => ({ words: cut.ctx.words, start: cut.start, end: cut.end, said: !!items[i].text.trim() }));
      montage.music = montageMusic(montage.segments, pieces, all.music, introOf(montage), intro?.hook && opener ? { seconds: intro.hook.duration, piece: opener.sound } : undefined, track);
    }
    return { montage, files, jobs, ids: items.map((item) => item.id), ...(intro?.hook && opener ? { opener: { file: opener.file, job: opener.job } } : {}) };
}

/** What an export of a built video is asked with */
export function renderRequest(built: BuiltVideo, video: Pick<Compilation, "id" | "name">) {
  return {
    key: `comp_${video.id}.mp4`,
    name: video.name,
    pieces: renderPieces(built.montage, built.files, built.jobs),
    overlays: built.montage.overlays,
    ...(built.montage.intro ? { intro: renderIntro(built.montage.intro, built.opener?.file, built.opener?.job) } : {}),
    ...(built.montage.music ? { music: built.montage.music } : {}),
  };
}
