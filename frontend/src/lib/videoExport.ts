import { ensurePieces, getEditEnvironment, startMontageRender, type Compilation, type EditEnvironment } from "./api";
import { allItems, pieceAsk } from "./compilation";
import { FPS, buildVideo, covers, pieceVersion, renderRequest, type BuildWith, type BuiltVideo, type Piece } from "./videoBuild";

/**
 * A video exported without its montage being open: its passages' clips are made sure of, their
 * data read, the video built as its montage would show it, and the export asked. What several
 * videos kept from a live are exported with, one after the other.
 */

/** Clips cut from the live at once */
const CUT_BATCH = 4;

/** Thrown when a passage's clip can't be had (the live left Twitch, the engine is away) */
export class NotReady extends Error {}

/** The video as Remotion plays it, its clips cut when they were not */
export async function prepareVideo(using: BuildWith, video: Compilation): Promise<BuiltVideo> {
  const items = allItems(video);
  if (items.length === 0) throw new NotReady("no passage");
  const states: Record<string, Piece> = {};
  for (const item of items) {
    if (item.file) states[item.id] = { ready: !!item.ready, file: item.file, file_start: item.file_start ?? null, file_end: item.file_end ?? null, job: item.job ?? using.jobId };
  }
  const todo = items.filter((item) => !covers(states[item.id], item));
  // Each live cuts its own passages, a few at a time (a video of the media library is put in the video's own live)
  for (const live of new Set(todo.map((item) => item.job ?? using.jobId))) {
    const theirs = todo.filter((item) => (item.job ?? using.jobId) === live);
    for (let i = 0; i < theirs.length; i += CUT_BATCH) {
      const done = await ensurePieces(live, theirs.slice(i, i + CUT_BATCH).map(({ fit: _rough, ...item }) => pieceAsk(item)));
      for (const { id, tight: _found, ...state } of done.pieces) states[id] = { ...state, job: live };
    }
  }
  if (items.some((item) => !covers(states[item.id], item))) throw new NotReady("a passage has no clip");
  const known: Record<string, EditEnvironment> = {};
  await Promise.all(
    [...new Map(items.map((item) => [pieceVersion(states[item.id]), states[item.id]])).entries()].map(async ([key, piece]) => {
      known[key] = await getEditEnvironment(piece.job, piece.file);
    }),
  );
  const built = buildVideo(using, video, states, known);
  if (!built) throw new NotReady("nothing to play");
  return built;
}

/** The export of a video is asked: its render's id */
export async function exportVideo(using: BuildWith, video: Compilation): Promise<string> {
  const built = await prepareVideo(using, video);
  return startMontageRender(using.jobId, renderRequest(built, video), { width: 1080, height: 1920, fps: FPS });
}
