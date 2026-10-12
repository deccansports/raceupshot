"use client";

import type { LiveBroadcastChannel } from "@/packages/contracts/src";
import Hls from "hls.js";
import { ExternalLink, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function youtubeEmbedUrl(value: string): string {
  try {
    const url = new URL(value);
    const id = url.hostname.includes("youtu.be")
      ? url.pathname.slice(1)
      : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1) || "";
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0` : value;
  } catch {
    return value;
  }
}

function VideoPlayer({ channel, posterUrl }: { channel: LiveBroadcastChannel; posterUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError("");
    if (channel.type !== "HLS" || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.playbackUrl;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    if (!Hls.isSupported()) {
      setError("This browser cannot play the HLS broadcast.");
      return;
    }
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 4 * 60 * 60,
    });
    hls.loadSource(channel.playbackUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else {
        setError("The live stream stopped unexpectedly. Please retry.");
        hls.destroy();
      }
    });
    return () => hls.destroy();
  }, [channel]);

  return (
    <div className="broadcast-player-frame">
      <video ref={videoRef} controls autoPlay playsInline poster={posterUrl} />
      {error && <div className="broadcast-player-error">{error}</div>}
    </div>
  );
}

export function LiveBroadcastPlayer({
  channel,
  posterUrl,
}: {
  channel: LiveBroadcastChannel | null;
  posterUrl?: string;
}) {
  const embedUrl = useMemo(() => channel?.type === "YOUTUBE" ? youtubeEmbedUrl(channel.playbackUrl) : channel?.playbackUrl, [channel]);
  if (!channel) {
    return (
      <div className="broadcast-player-empty" style={posterUrl ? { backgroundImage: `linear-gradient(rgba(3,7,18,.72),rgba(3,7,18,.9)),url("${posterUrl}")` } : undefined}>
        <Radio />
        <strong>Broadcast waiting</strong>
        <span>The player will appear when an enabled channel is published.</span>
      </div>
    );
  }
  if (channel.type === "HLS" || channel.type === "VIDEO") {
    return <VideoPlayer channel={channel} posterUrl={channel.posterUrl || posterUrl} />;
  }
  if (channel.type === "YOUTUBE" || channel.type === "IFRAME") {
    return <iframe className="broadcast-player-iframe" src={embedUrl} title={channel.name} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />;
  }
  return (
    <div className="broadcast-player-empty" style={posterUrl ? { backgroundImage: `linear-gradient(rgba(3,7,18,.72),rgba(3,7,18,.9)),url("${posterUrl}")` } : undefined}>
      <ExternalLink />
      <strong>{channel.name}</strong>
      <span>This channel opens in its broadcast provider.</span>
      <a className="button button-primary" href={channel.playbackUrl} target="_blank" rel="noreferrer">Open broadcast <ExternalLink /></a>
    </div>
  );
}
