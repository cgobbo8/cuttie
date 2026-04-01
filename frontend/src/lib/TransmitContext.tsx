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
  const esRef = useRef<EventSource | null>(null);
  const uidRef = useRef(`cuttie_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const subscribedChannelsRef = useRef<Set<string>>(new Set());

  // Open the SSE tunnel once
  useEffect(() => {
    const uid = uidRef.current;
    const url = `${BASE_URL}/__transmit/events?uid=${uid}`;
    // console.log(`[Transmit] Opening tunnel: ${url}`);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      // console.log(`[Transmit] Tunnel opened`);
      // Re-subscribe all active channels (in case of reconnect)
      for (const channel of subscribedChannelsRef.current) {
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

    es.onerror = () => {
      // console.log(`[Transmit] Tunnel error (will auto-reconnect)`);
    };

    return () => {
      // console.log(`[Transmit] Closing tunnel`);
      // Unsubscribe all channels
      for (const channel of subscribedChannelsRef.current) {
        postUnsubscribe(uid, channel);
      }
      es.close();
      esRef.current = null;
    };
  }, []);

  const subscribe = useCallback((channel: string, listener: Listener): (() => void) => {
    // Add listener
    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel)!.add(listener);

    // Subscribe to channel on server if first listener
    if (!subscribedChannelsRef.current.has(channel)) {
      subscribedChannelsRef.current.add(channel);
      postSubscribe(uidRef.current, channel);
    }

    // Return unsubscribe function
    return () => {
      const set = listenersRef.current.get(channel);
      if (set) {
        set.delete(listener);
        // Unsubscribe from server if no more listeners for this channel
        if (set.size === 0) {
          listenersRef.current.delete(channel);
          subscribedChannelsRef.current.delete(channel);
          postUnsubscribe(uidRef.current, channel);
        }
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
  // console.log(`[Transmit] Subscribing to ${channel}`);
  fetch(`${BASE_URL}/__transmit/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, channel }),
  }).then((r) => // console.log(`[Transmit] Subscribe ${channel}: ${r.status}`))
    .catch((e) => console.error(`[Transmit] Subscribe failed:`, e));
}

function postUnsubscribe(uid: string, channel: string) {
  // console.log(`[Transmit] Unsubscribing from ${channel}`);
  fetch(`${BASE_URL}/__transmit/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, channel }),
  }).catch(() => {});
}
