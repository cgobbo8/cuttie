import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  detectBrandColors,
  getBrandKit,
  getTwitchChannel,
  updateBrandKit,
  type BrandKit,
  type BrandKitPatch,
  type TwitchChannel,
} from "./api";
import { useAuth } from "./AuthContext";
import { applyAccent } from "./color";
import { useDefaultBackdrop } from "./BackdropContext";

/**
 * The streamer's identity, shared by the whole app: their brand kit (colors,
 * widget, webcam) and their Twitch channel with recent lives.
 */

interface ChannelContextValue {
  kit: BrandKit | null;
  /** undefined while loading, null when no channel is set up */
  channel: TwitchChannel | null | undefined;
  channelError: string | null;
  /** Reload the channel (and the analyses linked to its lives) */
  refreshChannel: () => Promise<void>;
  saveKit: (patch: BrandKitPatch) => Promise<BrandKit>;
  redetectColors: () => Promise<BrandKit>;
}

const ChannelContext = createContext<ChannelContextValue>({
  kit: null,
  channel: undefined,
  channelError: null,
  refreshChannel: async () => {},
  saveKit: async () => {
    throw new Error("ChannelProvider missing");
  },
  redetectColors: async () => {
    throw new Error("ChannelProvider missing");
  },
});

export function ChannelProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [channel, setChannel] = useState<TwitchChannel | null | undefined>(undefined);
  const [channelError, setChannelError] = useState<string | null>(null);
  const autoDetected = useRef(false);

  const refreshChannel = useCallback(async () => {
    try {
      setChannel(await getTwitchChannel());
      setChannelError(null);
    } catch (err) {
      setChannel(null);
      setChannelError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    getBrandKit().then(setKit).catch(() => {});
    refreshChannel();
  }, [user, refreshChannel]);

  // The whole app wears the streamer's color
  useEffect(() => {
    if (kit) applyAccent(kit.colors.accent);
  }, [kit]);

  // First time we see the channel's logo: pick the brand colors from it
  useEffect(() => {
    if (!kit || !channel?.avatar_url || autoDetected.current) return;
    if (kit.palette.length > 0 && kit.palette_source === channel.avatar_url) return;
    autoDetected.current = true;
    detectBrandColors().then(setKit).catch(() => {});
  }, [kit, channel]);

  const latest = channel?.vods.find((v) => v.thumbnail_url);
  useDefaultBackdrop(latest?.thumbnail_url ?? channel?.banner_url);

  const saveKit = useCallback(async (patch: BrandKitPatch) => {
    const next = await updateBrandKit(patch);
    setKit(next);
    if (patch.twitch_login !== undefined) {
      autoDetected.current = false;
      setChannel(undefined);
      await refreshChannel();
    }
    return next;
  }, [refreshChannel]);

  const redetectColors = useCallback(async () => {
    const next = await detectBrandColors();
    setKit(next);
    return next;
  }, []);

  return (
    <ChannelContext.Provider value={{ kit, channel, channelError, refreshChannel, saveKit, redetectColors }}>
      {children}
    </ChannelContext.Provider>
  );
}

export function useChannel() {
  return useContext(ChannelContext);
}
