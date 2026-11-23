import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useToast } from "../components/Toast";
import {
  AssistantBusy,
  assistantProgress,
  assistantTurn,
  getAssistant,
  getJobStatus,
  listCompilations,
  resetAssistant,
  type AssistantAction,
  type AssistantMessage,
  type AssistantPlace,
} from "./api";
import { useChannel } from "./ChannelContext";
import { stepText } from "./compilation";
import { useMusics } from "./music/library";
import { customTemplates } from "./templateKeys";
import { exportVideo } from "./videoExport";

/**
 * The assistant: one conversation beside the page, on every screen. Its panel, open, pushes the
 * whole page to the left (the top bar too) and sits side by side with it: it never covers what
 * the streamer is working on.
 *
 * It knows where the streamer is (each page says so: `useAssistantPlace`), answers, and acts:
 * what it does on a video is carried out by the page that edits it (`useAssistantActions`),
 * which it opens first when it is another one. The conversation is kept by the app (the API),
 * so it follows the streamer from one page to the next.
 */

/** How wide the panel is, pixels (the page gives that much room up when it is open) */
export const ASSISTANT_WIDTH = 420;
const KEPT = "cuttie_assistant_open";
/** How often it is asked what it is doing while its answer is awaited */
const PROGRESS_EVERY = 1200;
/** From this width on the panel sits beside the page; under it (a phone, a narrow window) it covers it */
const BESIDE = "(min-width: 1024px)";
/** How long a page may take to open before what it was to do is given up, ms */
const PAGE_WAIT = 25_000;

/** What a page does for the assistant: the action's answer (`{ error }` when it could not), as the assistant reads it */
export type AssistantRun = (name: string, args: Record<string, any>) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface AssistantValue {
  open: boolean;
  /** Open beside the page, which gives it its width (a window wide enough); else it covers the page */
  pushes: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** The conversation, the oldest message first (null: not loaded yet) */
  messages: AssistantMessage[] | null;
  /** It is answering: what it did so far for this request, a line each */
  busy: boolean;
  doing: string[];
  /** What the streamer just said, until its answer comes back */
  pending: string | null;
  /** The streamer says something (the panel opens) */
  send: (text: string) => void;
  /** Yes or no to what its last message asks the go-ahead for */
  approve: (yes: boolean) => void;
  /** A new conversation */
  reset: () => void;
  /** Something done on the streamer's screen as the assistant would (a passage of its answer added to the video) */
  act: (name: string, args: Record<string, any>) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Where the streamer is, as the page on screen says it */
  place: AssistantPlace | null;
  setPlace: (place: AssistantPlace | null) => void;
  /** A live's editor is on screen and does what the assistant asks on its videos */
  register: (job: string, run: AssistantRun) => () => void;
  /** Told the lives the assistant changed on the app's side (a clip kept, ideas added, an analysis started) */
  onChanged: (listener: (jobs: string[]) => void) => () => void;
  /** Something of these lives was changed from the panel itself (a clip kept from a card): the pages read them again */
  notify: (jobs: string[]) => void;
}

const nothing = () => {};
const AssistantContext = createContext<AssistantValue>({
  open: false,
  pushes: false,
  setOpen: nothing,
  toggle: nothing,
  messages: null,
  busy: false,
  doing: [],
  pending: null,
  send: nothing,
  approve: nothing,
  reset: nothing,
  act: async () => ({ error: "no assistant" }),
  place: null,
  setPlace: nothing,
  register: () => nothing,
  onChanged: () => nothing,
  notify: nothing,
});

function wasOpen(): boolean {
  try {
    return localStorage.getItem(KEPT) === "1";
  } catch {
    return false;
  }
}

/** The page an action of the assistant takes the streamer to */
export function pageOf(args: { page?: string; job?: string; video?: string; clip?: string }): string | null {
  const pick = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])).toString();
    return search ? `?${search}` : "";
  };
  switch (args.page) {
    case "lives":
      return "/projects";
    case "videos":
      return "/compilations";
    case "live":
      return args.job ? `/${args.job}${pick({ video: args.video, clip: args.clip })}` : null;
    case "edit":
      return args.job ? `/${args.job}/montage${pick({ v: args.video, clip: args.video ? undefined : args.clip })}` : null;
    case "export":
      return args.job ? `/${args.job}/export` : null;
    default:
      return null;
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { kit, channel } = useChannel();
  const musics = useMusics();
  const [open, setOpenState] = useState(wasOpen);
  const [messages, setMessages] = useState<AssistantMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [place, setPlaceState] = useState<AssistantPlace | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(KEPT, next ? "1" : "0");
    } catch {
      // No storage: it opens closed next time
    }
  }, []);
  const toggle = useCallback(
    () =>
      setOpenState((before) => {
        try {
          localStorage.setItem(KEPT, before ? "0" : "1");
        } catch {
          // (as above)
        }
        return !before;
      }),
    [],
  );

  // Wide enough for the two side by side?
  const [wide, setWide] = useState(() => typeof window === "undefined" || !window.matchMedia || window.matchMedia(BESIDE).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(BESIDE);
    const changed = () => setWide(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const pushes = open && wide;

  // The room it takes, for what is laid out against the window (the top bar)
  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-w", pushes ? `${ASSISTANT_WIDTH}px` : "0px");
  }, [pushes]);

  // Ctrl / Cmd + J opens and closes it from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  /* ── Where the streamer is, and who does what ───────────── */

  const placeRef = useRef<AssistantPlace | null>(null);
  const setPlace = useCallback((next: AssistantPlace | null) => {
    placeRef.current = next;
    setPlaceState((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
  }, []);

  // The editors on screen, by live, and who waits for one to open
  const editors = useRef(new Map<string, AssistantRun>());
  const waiting = useRef<{ job: string; resolve: (run: AssistantRun) => void }[]>([]);
  const register = useCallback((job: string, run: AssistantRun) => {
    editors.current.set(job, run);
    waiting.current = waiting.current.filter((one) => {
      if (one.job !== job) return true;
      one.resolve(run);
      return false;
    });
    return () => {
      if (editors.current.get(job) === run) editors.current.delete(job);
    };
  }, []);
  /** The editor of a live, opened first when it is not on screen */
  const editorOf = useCallback(
    (job: string, to: string) => {
      const known = editors.current.get(job);
      if (known) return Promise.resolve(known);
      return new Promise<AssistantRun>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          waiting.current = waiting.current.filter((one) => one.resolve !== found);
          reject(new Error("the editor did not open"));
        }, PAGE_WAIT);
        const found = (run: AssistantRun) => {
          window.clearTimeout(timer);
          resolve(run);
        };
        waiting.current.push({ job, resolve: found });
        navigate(to);
      });
    },
    [navigate],
  );

  const listeners = useRef(new Set<(jobs: string[]) => void>());
  const onChanged = useCallback((listener: (jobs: string[]) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const notify = useCallback((jobs: string[]) => listeners.current.forEach((listener) => listener(jobs)), []);

  /* ── What the assistant has the app do ──────────────────── */

  const using = useRef({ kit, channel, musics, t });
  using.current = { kit, channel, musics, t };
  /** One action carried out on the streamer's screen: what it answers is what the assistant is told */
  const perform = useCallback(
    async (action: AssistantAction): Promise<unknown> => {
      const args = action.args ?? {};
      try {
        if (action.name === "open") {
          const to = pageOf(args);
          if (!to) return { error: "no such page" };
          // (the editor already on screen for this live shows the video itself: its address would not)
          const editor = args.page === "edit" && args.job ? editors.current.get(args.job) : undefined;
          if (editor && (args.video || args.clip)) return await editor("open", args);
          navigate(to);
          return { opened: args.page };
        }
        if (action.name === "export_videos") {
          const { kit: brand, channel: who, musics: tracks, t: say } = using.current;
          if (!brand) return { error: "the app is not ready" };
          const started: { job: string; id: string; name: string }[] = [];
          const failed: { id: string; why: string }[] = [];
          const lives = new Map<string, Promise<{ game: string | null; videos: Awaited<ReturnType<typeof listCompilations>> }>>();
          for (const { job, id } of (Array.isArray(args.videos) ? args.videos : []) as { job: string; id: string }[]) {
            try {
              if (!lives.has(job)) lives.set(job, Promise.all([getJobStatus(job), listCompilations(job)]).then(([live, videos]) => ({ game: live.vod_game ?? null, videos })));
              const live = await lives.get(job)!;
              const video = live.videos.find((one) => one.id === id);
              if (!video) throw new Error("no such video");
              await exportVideo({ jobId: job, kit: brand, channel: who ?? null, customs: customTemplates(brand), game: live.game, musics: tracks, t: say }, video);
              started.push({ job, id, name: video.name });
            } catch (err) {
              failed.push({ id, why: err instanceof Error ? err.message : "failed" });
            }
          }
          // Where the exports are followed (already there: its list is read again)
          if (started.length > 0) {
            navigate(`/${started[0].job}/export`);
            listeners.current.forEach((listener) => listener(started.map((one) => one.job)));
          }
          return { started, ...(failed.length > 0 ? { failed } : {}) };
        }
        // The rest is done on a video, by the editor of its live
        if (typeof args.job !== "string") return { error: "no live named" };
        const to = pageOf({ page: "edit", job: args.job, video: args.video ?? args.idea, clip: args.clip });
        const editor = await editorOf(args.job, to ?? `/${args.job}/montage`);
        return await editor(action.name, args);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "failed" };
      }
    },
    [editorOf, navigate],
  );

  /* ── The conversation ───────────────────────────────────── */

  const running = useRef(false);
  const keep = useCallback((said: AssistantMessage | undefined, message: AssistantMessage) => {
    setMessages((before) => {
      const list = [...(before ?? [])];
      for (const one of [said, message]) {
        if (!one) continue;
        const at = list.findIndex((other) => other.id === one.id);
        // (something new said drops what the message before waited for)
        if (at < 0 && one.role === "user" && list.length > 0 && list[list.length - 1].action) list[list.length - 1] = { ...list[list.length - 1], action: null };
        if (at < 0) list.push(one);
        else list[at] = one;
      }
      return list;
    });
  }, []);

  /** One request, then every action it hands to the page, until it is done or asks the streamer */
  const run = useCallback(
    async (first: { text?: string; resume?: { call: string; result: unknown } } | { from: AssistantMessage }) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setDoing([]);
      setPending("text" in first && first.text ? first.text : null);
      const ask = (body: { text?: string; resume?: { call: string; result: unknown } }) => assistantTurn({ ...body, context: placeRef.current, language: i18n.language.slice(0, 2) });
      try {
        let message: AssistantMessage;
        if ("from" in first) message = first.from;
        else {
          const answer = await ask(first);
          keep(answer.said, answer.message);
          setPending(null);
          if (answer.changed.length > 0) listeners.current.forEach((listener) => listener(answer.changed));
          message = answer.message;
        }
        // What it hands to the page is done, and it goes on with the answer
        while (message.action?.needs === "app") {
          const action = message.action;
          const result = await perform(action);
          const answer = await ask({ resume: { call: action.call, result } });
          keep(undefined, answer.message);
          if (answer.changed.length > 0) listeners.current.forEach((listener) => listener(answer.changed));
          message = answer.message;
        }
      } catch (err) {
        if (err instanceof AssistantBusy) toast.info(t("assistant.busy"));
        else if (err instanceof Error && err.message === "nothing_waiting") {
          // (what it waited for was dropped meanwhile: the conversation as the app kept it)
          getAssistant().then((kept) => setMessages(kept.messages)).catch(() => {});
        } else toast.error(t("assistant.failed.unreachable"));
      } finally {
        running.current = false;
        setBusy(false);
        setDoing([]);
        setPending(null);
      }
    },
    [i18n.language, keep, perform, t, toast],
  );

  // The conversation as the app kept it; still answering (the page was loaded again meanwhile): followed to its end
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = async (wasBusy: boolean) => {
      try {
        const kept = await getAssistant();
        if (cancelled) return;
        if (running.current) return;
        setMessages(kept.messages);
        setBusy(kept.busy);
        if (kept.busy) timer = window.setTimeout(() => load(true), PROGRESS_EVERY);
        else if (wasBusy) {
          // It ended on something for the page to do: done now
          const last = kept.messages[kept.messages.length - 1];
          if (last?.role === "assistant" && last.action?.needs === "app") run({ from: last });
        }
      } catch {
        if (!cancelled) setMessages((before) => before ?? []);
      }
    };
    load(false);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // What it is doing, while its answer is awaited
  useEffect(() => {
    if (!busy) return;
    let stopped = false;
    const ask = async () => {
      const now = await assistantProgress().catch(() => null);
      if (stopped || !now) return;
      // (a search it handed to a loop of its own: what that loop is doing, under its line)
      const sub = now.sub ? stepText(t, now.sub) : "";
      setDoing(sub && now.steps[now.steps.length - 1] !== sub ? [...now.steps, sub] : now.steps);
    };
    const timer = window.setInterval(ask, PROGRESS_EVERY);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [busy, t]);

  const send = useCallback(
    (text: string) => {
      const said = text.trim();
      if (!said) return;
      setOpen(true);
      if (running.current) return toast.info(t("assistant.busy"));
      run({ text: said });
    },
    [run, setOpen, t, toast],
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const approve = useCallback(
    (yes: boolean) => {
      const last = messagesRef.current?.[messagesRef.current.length - 1];
      if (last?.role !== "assistant" || last.action?.needs !== "approval") return;
      run({ resume: { call: last.action.call, result: { approved: yes } } });
    },
    [run],
  );
  const reset = useCallback(() => {
    if (running.current) return toast.info(t("assistant.busy"));
    resetAssistant()
      .then(() => setMessages([]))
      .catch((err) => (err instanceof AssistantBusy ? toast.info(t("assistant.busy")) : toast.error(t("common.error"))));
  }, [t, toast]);

  const act = useCallback((name: string, args: Record<string, any>) => perform({ call: "", name, args, needs: "app" }), [perform]); // eslint-disable-line @typescript-eslint/no-explicit-any

  const value = useMemo(
    () => ({ open, pushes, setOpen, toggle, messages, busy, doing, pending, send, approve, reset, act, place, setPlace, register, onChanged, notify }),
    [open, pushes, setOpen, toggle, messages, busy, doing, pending, send, approve, reset, act, place, setPlace, register, onChanged, notify],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export const useAssistant = () => useContext(AssistantContext);

/** The page on screen says where the streamer is: what « this live », « this video », « this clip » mean to the assistant */
export function useAssistantPlace(place: AssistantPlace | null) {
  const { setPlace } = useAssistant();
  const key = JSON.stringify(place);
  useEffect(() => {
    setPlace(key ? (JSON.parse(key) as AssistantPlace | null) : null);
  }, [key, setPlace]);
  useEffect(() => () => setPlace(null), [setPlace]);
}

/** A live's editor does what the assistant asks on its videos, for as long as it is on screen (`job`: null until it is ready) */
export function useAssistantActions(job: string | null | undefined, run: AssistantRun) {
  const { register } = useAssistant();
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!job) return;
    return register(job, (name, args) => latest.current(name, args));
  }, [job, register]);
}

/** Called when the assistant changed this live on the app's side (a clip kept, ideas added): the page reads it again */
export function useAssistantChanged(job: string | null | undefined, changed: () => void) {
  const { onChanged } = useAssistant();
  const latest = useRef(changed);
  latest.current = changed;
  useEffect(() => {
    if (!job) return;
    return onChanged((jobs) => jobs.includes(job) && latest.current());
  }, [job, onChanged]);
}
