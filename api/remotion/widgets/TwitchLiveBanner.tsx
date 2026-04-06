import React from "react";

interface Props {
  props: Record<string, unknown>;
  width: number;
  height: number;
  currentTime?: number;
}

const CURTAIN_IN_START = 0.0;
const CURTAIN_IN_END = 0.28;
const CONTENT_IN_START = 0.12;
const CONTENT_IN_END = 0.40;
const CURTAIN_OUT_START = 0.30;
const CURTAIN_OUT_END = 0.55;
const BADGE_START = 0.35;
const BADGE_END = 0.65;
const LOOP_PERIOD = 8;
const LOOP_HOLD = 5;
const LOOP_SWEEP = 0.5;

function easeOutPower3(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

function easeSweep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.4) return 0.5 * easeOutPower3(c / 0.4);
  if (c < 0.6) return 0.5 + 0.12 * ((c - 0.4) / 0.2);
  return 0.62 + 0.38 * easeOutPower3((c - 0.6) / 0.4);
}

function springPop(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.45) return 1.2 * easeOutPower3(c / 0.45);
  if (c < 0.7) return 1.2 - 0.25 * easeOutPower3((c - 0.45) / 0.25);
  return 0.95 + 0.05 * easeOutPower3((c - 0.7) / 0.3);
}

function microBounce(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 + 0.08 * Math.sin(c * Math.PI);
}

function prog(time: number, start: number, end: number): number {
  if (time < start) return 0;
  if (time > end) return 1;
  return (time - start) / (end - start);
}


export default function TwitchLiveBanner({ props, width, height, currentTime = 0 }: Props) {
  const streamerName = (props.streamerName as string) || "streamer";
  const logoUrl = (props.logoUrl as string) || "";
  const time = currentTime;
  const fullUrl = `TWITCH.TV/${streamerName.toUpperCase()}`;

  const entranceDone = time > BADGE_END;
  const eCurtainIn = easeOutPower3(prog(time, CURTAIN_IN_START, CURTAIN_IN_END));
  const eCurtainOut = easeOutPower3(prog(time, CURTAIN_OUT_START, CURTAIN_OUT_END));
  const eContentIn = easeOutPower3(prog(time, CONTENT_IN_START, CONTENT_IN_END));
  const eBadgeP = springPop(prog(time, BADGE_START, BADGE_END));
  const eBadgeScale = time < BADGE_START ? 0 : eBadgeP;

  const loopTime = entranceDone ? ((time - BADGE_END) % LOOP_PERIOD + LOOP_PERIOD) % LOOP_PERIOD : -1;
  const inSweep = loopTime >= LOOP_HOLD && loopTime < LOOP_HOLD + LOOP_SWEEP;

  const sweepP = inSweep ? easeSweep((loopTime - LOOP_HOLD) / LOOP_SWEEP) : -1;
  const loopCurtainX = sweepP >= 0 ? -100 + sweepP * 210 : -999;
  const loopBadgeBounce = inSweep ? microBounce((loopTime - LOOP_HOLD) / LOOP_SWEEP) : 1;

  const entranceCurtainLeft = eCurtainOut * 100;
  const entranceCurtainRight = (1 - eCurtainIn) * 100;
  const entranceCurtainVisible = !entranceDone && entranceCurtainRight < 100 && entranceCurtainLeft < 100;
  const contentX = entranceDone ? 0 : (1 - eContentIn) * -105;
  const badgeScale = entranceDone ? loopBadgeBounce : eBadgeScale;

  const glowT = entranceDone ? ((time - BADGE_END) % 2.5) / 2.5 : 0;
  const glowSin = 0.5 + 0.5 * Math.sin(glowT * Math.PI * 2);
  const livePulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * Math.PI * 2.5));

  const badgeH = Math.round(height * 0.3);
  const urlH = height - badgeH;
  const iconSize = Math.round(badgeH * 0.55);
  const urlFontSize = Math.max(16, Math.min(Math.round(urlH * 0.38), Math.round(width / 18)));
  const badgeFontSize = Math.max(9, Math.round(badgeH * 0.34));
  const logoSize = Math.round(urlH * 0.55);
  const hasLogo = logoUrl.length > 0;
  const accentW = Math.max(3, Math.round(height * 0.018));

  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-end", position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "stretch", alignSelf: "center", marginBottom: -1,
          transform: `scale(${badgeScale})`, transformOrigin: "center bottom",
          filter: entranceDone ? `drop-shadow(0 0 ${Math.round(8 + 6 * glowSin)}px rgba(145,70,255,${0.2 + 0.15 * glowSin}))` : undefined,
          zIndex: 2, position: "relative",
        }}
      >
        <div style={{ width: badgeH, height: badgeH, background: "linear-gradient(180deg, #A970FF 0%, #9146FF 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: iconSize, height: iconSize }}>
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
          </svg>
        </div>
        <div style={{ height: badgeH, background: "linear-gradient(180deg, #A970FF 0%, #8B3FE8 100%)", display: "flex", alignItems: "center", gap: Math.round(badgeH * 0.2), padding: `0 ${Math.round(badgeH * 0.4)}px` }}>
          <div style={{ width: Math.max(6, Math.round(badgeH * 0.18)), height: Math.max(6, Math.round(badgeH * 0.18)), borderRadius: "50%", background: "#FF4444", boxShadow: `0 0 ${Math.round(6 + 4 * livePulse)}px rgba(255,68,68,${livePulse})`, opacity: livePulse, flexShrink: 0 }} />
          <span style={{ color: "#fff", fontSize: badgeFontSize, fontWeight: 800, fontFamily: "Inter, sans-serif", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>EN LIVE SUR</span>
        </div>
      </div>

      <div style={{ height: urlH, alignSelf: "center", position: "relative", overflow: "hidden", display: "inline-flex", filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.5))" }}>
        <div style={{ display: "flex", alignItems: "stretch", transform: `translateX(${contentX}%)`, position: "relative", zIndex: 0 }}>
          <div style={{ width: accentW, background: "linear-gradient(180deg, #A970FF 0%, #7B2FD8 100%)", flexShrink: 0 }} />
          <div style={{ background: "linear-gradient(135deg, rgba(20,20,25,0.93) 0%, rgba(10,10,14,0.96) 100%)", display: "flex", alignItems: "center", gap: Math.round(urlH * 0.1), padding: `0 ${Math.round(urlH * 0.2)}px` }}>
            {hasLogo && <img src={logoUrl} alt="" style={{ width: logoSize, height: logoSize, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <span style={{ color: "#fff", fontSize: urlFontSize, fontWeight: 900, fontFamily: "Inter, sans-serif", letterSpacing: "-0.01em", lineHeight: 1, whiteSpace: "nowrap", minHeight: "1em" }}>
              {fullUrl}
            </span>
          </div>
          <div style={{ width: accentW, background: "linear-gradient(180deg, #A970FF 0%, #7B2FD8 100%)", flexShrink: 0 }} />
        </div>

        {entranceCurtainVisible && (
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${entranceCurtainLeft}%`, right: `${entranceCurtainRight}%`, background: "linear-gradient(135deg, #A970FF 0%, #8B3FE8 50%, #7B2FD8 100%)", zIndex: 1 }} />
        )}
        {inSweep && (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: "100%", transform: `translateX(${loopCurtainX}%)`, background: "linear-gradient(135deg, #A970FF 0%, #8B3FE8 50%, #7B2FD8 100%)", zIndex: 1 }} />
        )}
      </div>
    </div>
  );
}
