import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Scissors } from "lucide-react";
import { detectBrandFacecam, setOnboarded, type FacecamRect } from "../lib/api";
import { applyAccent } from "../lib/color";
import { useChannel } from "../lib/ChannelContext";
import { useSettings } from "../lib/SettingsContext";
import { useToast } from "../components/Toast";
import LiveWall from "../components/welcome/LiveWall";
import ChannelStep from "../components/welcome/ChannelStep";
import KeysStep from "../components/welcome/KeysStep";
import { useKeyChecks } from "../components/KeyField";
import WebcamStep from "../components/welcome/WebcamStep";
import ReadyStep from "../components/welcome/ReadyStep";
import { CamPeek, ChannelPeek, KeysPeek } from "../components/welcome/Peek";
import type { CamSearch, FoundChannel } from "../components/welcome/shared";

type Step = "channel" | "keys" | "cam" | "ready";

/** Steps around the current one: hidden when the window is too narrow for three cards */
function Side({ children }: { children: ReactNode }) {
  return <div className="hidden min-[1340px]:block">{children}</div>;
}

/**
 * First launch, in three steps: the Twitch channel (lives + logo colors), the
 * two API keys, and the webcam found on the latest live. Behind the glass:
 * the streamer's own lives.
 */
export default function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { kit, channel, saveKit } = useChannel();
  const { refresh } = useSettings();

  const [step, setStep] = useState<Step>("channel");
  const [found, setFound] = useState<FoundChannel | null>(null);
  const [noChannel, setNoChannel] = useState(false);
  const [camSearch, setCamSearch] = useState<CamSearch>({ status: "idle" });
  const [camDone, setCamDone] = useState(false);
  const finished = useRef<Promise<unknown> | null>(null);

  const keys = useKeyChecks();

  // The whole screen takes the channel's color as soon as we know it
  const accent = found?.colors?.roles.accent ?? kit?.colors.accent;
  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);

  const vods = found?.channel.vods ?? (noChannel ? [] : channel?.vods ?? []);
  const wall = useMemo(() => vods.map((v) => v.thumbnail_url).filter((u): u is string => !!u), [vods]);
  const latestThumb = vods.find((v) => v.thumbnail_large_url)?.thumbnail_large_url ?? null;

  const searchCam = useCallback(() => {
    setCamSearch({ status: "searching" });
    detectBrandFacecam()
      .then((result) => setCamSearch({ status: "done", result }))
      .catch((err) => setCamSearch({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  }, []);

  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t("welcome.saveError"));

  const confirmChannel = async (picked: FoundChannel) => {
    try {
      await saveKit({ twitch_login: picked.channel.login });
      setNoChannel(false);
      setCamDone(false);
      // Reading frames of the latest live takes a few seconds: start while the keys are pasted
      searchCam();
      setStep("keys");
    } catch (err) {
      fail(err);
    }
  };

  const confirmCam = async (rect: FacecamRect, frameKey: string | null) => {
    try {
      await saveKit({ facecam: rect, facecam_frame: frameKey });
      setCamDone(true);
      setStep("ready");
    } catch (err) {
      fail(err);
    }
  };

  const noCam = async () => {
    try {
      await saveKit({ facecam: false });
      setCamDone(true);
      setStep("ready");
    } catch (err) {
      fail(err);
    }
  };

  // Reaching the end marks the first launch as done
  useEffect(() => {
    if (step === "ready") finished.current = setOnboarded(true).then(refresh);
  }, [step, refresh]);

  const go = async () => {
    try {
      await finished.current;
      navigate("/", { replace: true });
    } catch (err) {
      fail(err);
    }
  };

  const camResult = camSearch.status === "done" ? camSearch.result : null;

  const active = (
    <section
      key={step}
      aria-current="step"
      className={`glass-strong rounded-[22px] p-[30px] max-w-full animate-rise ${step === "ready" ? "w-[620px]" : "w-[540px]"}`}
    >
      {step === "channel" ? (
        kit ? (
          <ChannelStep
            initialLogin={found?.channel.login ?? kit.twitch_login}
            found={found}
            setFound={setFound}
            onContinue={confirmChannel}
            onSkip={() => {
              setNoChannel(true);
              setFound(null);
              setStep("keys");
            }}
          />
        ) : (
          <div className="h-[380px] rounded-[14px] skeleton" />
        )
      ) : step === "keys" ? (
        <KeysStep stateOf={keys.stateOf} setKeyState={keys.setKeyState} ready={keys.requiredOk} onContinue={() => setStep(noChannel ? "ready" : "cam")} />
      ) : step === "cam" ? (
        <WebcamStep
          search={camSearch}
          placeholder={latestThumb}
          onRetry={searchCam}
          onConfirm={confirmCam}
          onNoCam={noCam}
          onSkip={() => setStep("ready")}
        />
      ) : (
        kit && (
          <ReadyStep
            kit={kit}
            frameUrl={noChannel ? null : camResult?.frame_url ?? latestThumb}
            login={noChannel ? null : found?.channel.login ?? kit.twitch_login}
            avatarUrl={noChannel ? null : found?.channel.avatar_url ?? channel?.avatar_url ?? null}
            keysMissing={!keys.requiredOk}
            onAddKeys={() => setStep("keys")}
            onGo={go}
          />
        )
      )}
    </section>
  );

  return (
    <div className="relative min-h-dvh text-ink">
      <LiveWall images={wall} />
      <div className="relative z-[1] min-h-dvh flex flex-col">
        <header className="flex items-center justify-between gap-4 px-10 pt-7">
          <div className="flex items-center gap-2.5">
            <span className="w-[30px] h-[30px] rounded-[9px] bg-ink grid place-items-center">
              <Scissors className="w-4 h-4 text-ground" strokeWidth={2.4} />
            </span>
            <span className="text-[17px] font-[650] tracking-[-0.02em] text-white">Cuttie</span>
          </div>
          {step !== "ready" && <span className="text-[13px] text-ink-2">{t("welcome.setup")}</span>}
        </header>

        <main className="flex-1 flex items-center justify-center gap-[22px] px-10 pt-8 pb-12">
          {step === "ready" ? (
            active
          ) : (
            <>
              {step === "channel" ? (
                active
              ) : (
                <Side>
                  <ChannelPeek found={noChannel ? null : found} onEdit={() => setStep("channel")} />
                </Side>
              )}
              {step === "keys" ? (
                active
              ) : (
                <Side>
                  <KeysPeek done={step === "cam" && keys.requiredOk} stateOf={keys.stateOf} onEdit={() => setStep("keys")} />
                </Side>
              )}
              {step === "cam"
                ? active
                : !noChannel && (
                    <Side>
                      <CamPeek search={camSearch} placeholder={latestThumb} confirmed={kit?.facecam ?? null} done={camDone} onEdit={() => setStep("cam")} />
                    </Side>
                  )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
