/**
 * TransmitContext — single SSE tunnel at app level via @adonisjs/transmit.
 *
 * One EventSource per app, pages subscribe/unsubscribe to channels as needed.
 * The tunnel survives navigations.
 */

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react";

const BASE_URL = "";  // relative — Vite proxy forwards /__transmit to API

type Listener = (data: unknown) => void;

interface TransmitContextValue {
  subscribe: (channel: string, listener: Listener) => () => void;
}

const TransmitContext = createContext<TransmitContextValue | null>(null);

export function TransmitProvider({ children }: { children: ReactNode }) {
  /** uid of the open stream, null until the server knows it */
  const openUidRef = useRef<string | null>(null);
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const channelsRef = useRef<Set<string>>(new Set());

  // Open the SSE tunnel once. Each stream gets its own uid: subscriptions are
  // only sent once the server knows it, and closing the stream drops them, so a
  // late unsubscribe from a previous stream can never cancel a new one.
  useEffect(() => {
    const uid = `cuttie_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const es = new EventSource(`${BASE_URL}/__transmit/events?uid=${uid}`);

    es.onopen = () => {
      openUidRef.current = uid;
      // First open, or the browser reconnected: (re)subscribe everything
      for (const channel of channelsRef.current) {
        postSubscribe(uid, channel);
      }
    };

    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        // Transmit format: { channel, payload } or other shapes
        const channel = raw.channel ?? raw.c;
        const payload = raw.payload ?? raw.p;
        if (!channel) return;

        const data = typeof payload === "string" ? JSON.parse(payload) : payload;
        const channelListeners = listenersRef.current.get(channel);
        if (channelListeners) {
          for (const listener of channelListeners) {
            listener(data);
          }
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (openUidRef.current === uid) openUidRef.current = null;
      es.close();
    };
  }, []);

  const subscribe = useCallback((channel: string, listener: Listener): (() => void) => {
    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel)!.add(listener);

    // First listener: subscribe on the server (now, or when the stream opens)
    if (!channelsRef.current.has(channel)) {
      channelsRef.current.add(channel);
      if (openUidRef.current) postSubscribe(openUidRef.current, channel);
    }

    return () => {
      const set = listenersRef.current.get(channel);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        listenersRef.current.delete(channel);
        channelsRef.current.delete(channel);
        if (openUidRef.current) postUnsubscribe(openUidRef.current, channel);
      }
    };
  }, []);

  return (
    <TransmitContext.Provider value={{ subscribe }}>
      {children}
    </TransmitContext.Provider>
  );
}

export function useTransmitChannel(channel: string | null, listener: (data: unknown) => void) {
  const ctx = useContext(TransmitContext);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!ctx || !channel) return;
    return ctx.subscribe(channel, (data) => listenerRef.current(data));
  }, [ctx, channel]);
}

function postSubscribe(uid: string, channel: string) {
  fetch(`${BASE_URL}/__transmit/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, channel }),
  }).catch(() => {});
}

function postUnsubscribe(uid: string, channel: string) {
  fetch(`${BASE_URL}/__transmit/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, channel }),
  }).catch(() => {});
}
