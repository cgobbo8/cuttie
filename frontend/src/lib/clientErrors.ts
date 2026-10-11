import { reportClientError } from "./api";

/** At most this many errors per page load: a loop throwing on every frame stays a few lines */
const MAX_REPORTS = 20;

/**
 * Errors of the page go to the app's journal (Settings > Help from afar), so
 * whoever helps from afar sees them too. Same message once only.
 */
export function watchClientErrors(target: Window = window, report = reportClientError): () => void {
  const seen = new Set<string>();
  const send = (kind: string, message: string, stack?: string) => {
    if (seen.size >= MAX_REPORTS || seen.has(message)) return;
    seen.add(message);
    report({ kind, message, stack, page: target.location?.pathname });
  };
  const onError = (event: ErrorEvent) => {
    // A resource that failed to load (an image, a video) is not an error of the code
    if (!event.message) return;
    send("error", event.message, event.error instanceof Error ? event.error.stack : `${event.filename}:${event.lineno}`);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    send("rejection", reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
