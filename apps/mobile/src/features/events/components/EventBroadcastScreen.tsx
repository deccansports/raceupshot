import { createElement, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView as NativeWebView } from 'react-native-webview';

import { queryKeys } from '@/core/services/query/queryKeys';
import { useTheme } from '@/core/theme';
import { getCountryFlagEmoji } from '@/core/utils';
import { useEvent } from '@/features/events/hooks/useEvents';
import { safeRouteEventId } from '@/features/events/utils/eventRoute';
import { Avatar, Button, Card, ErrorState, Skeleton, Text } from '@/shared/components';
import { ProgressBar } from '@/shared/components/ui';

import {
  Platform,
  View,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions as useWindowDimensionsRN,
} from 'react-native';

type PlayerMode = 'live' | 'replay' | 'offline';
type BroadcastStatus = 'offline' | 'scheduled' | 'connecting' | 'live' | 'interrupted' | 'ended';
type ChannelInfo = {
  id?: string;
  name?: string;
  type?: string;
};

type AthleteFeed = {
  id?: string;
  name?: string;
  bib?: string;
  discipline?: string;
  contestName?: string;
  ageGroup?: string;
  countryFlag?: string;
  progress?: number | null;
  estimatedSecondsToFinish?: number | null;
  distanceRemainingMeters?: number | null;
  status?: string;
  photoUrl?: string;
  profilePhotoUrl?: string;
  lastUpdated?: string;
};

type BroadcastAd = {
  adId: string;
  youtubeId: string;
  title: string;
  placement: 'full_screen' | 'picture_in_picture';
  cameraId: string | null;
  startsAt: string;
  endsAt: string | null;
  durationSeconds: number;
  repeatEveryMinutes: number;
  active: boolean;
};

type FeaturedBroadcastVideo = {
  youtubeId: string;
  title: string;
  description: string | null;
};

type BroadcastPayload = {
  eventId: string;
  status: BroadcastStatus;
  enabled: boolean;
  highlightsEnabled: boolean;
  title: string;
  subtitle: string | null;
  message: string | null;
  activeChannel: ChannelInfo | null;
  hlsUrl: string | null;
  posterUrl: string | null;
  replayUrl: string | null;
  replayDurationSeconds: number | null;
  scheduledStartTime: string | null;
  startedAt: string | null;
  streamQuality: string | null;
  viewerCount: number | null;
  connectionStatus: string | null;
  updatedAt: string | null;
  approachingAthletes: AthleteFeed[];
  upcomingAthletes: AthleteFeed[];
  eventBannerUrl: string | null;
  eventLogoUrl: string | null;
  version: number;
  ads: BroadcastAd[];
  featuredVideo: FeaturedBroadcastVideo | null;
};

const EMPTY_PAYLOAD: BroadcastPayload = {
  eventId: '',
  status: 'offline',
  enabled: false,
  highlightsEnabled: false,
  title: 'Race Upshot Live Broadcast',
  subtitle: 'Live race broadcast',
  message: 'No broadcast feed has been published yet.',
  activeChannel: null,
  hlsUrl: null,
  posterUrl: null,
  replayUrl: null,
  replayDurationSeconds: null,
  scheduledStartTime: null,
  startedAt: null,
  streamQuality: null,
  viewerCount: null,
  connectionStatus: null,
  updatedAt: null,
  approachingAthletes: [],
  upcomingAthletes: [],
  eventBannerUrl: null,
  eventLogoUrl: null,
  version: 0,
  ads: [],
  featuredVideo: null,
};

const playerHtmlCache = new Map<string, string>();
const LIVE_BROADCAST_BASE_URL = 'https://raceupshot.com';
const RACEUPSHOT_BROADCAST_PATH = '/api/v1/events/{eventId}/broadcast';

type RawLiveBroadcastResponse = {
  success?: unknown;
  data?: {
    eventId?: unknown;
    enabled?: unknown;
    status?: unknown;
    hlsUrl?: unknown;
    highlightsEnabled?: unknown;
    version?: unknown;
    approachingAthletes?: unknown;
    upcomingAthletes?: unknown;
    replayUrl?: unknown;
    posterUrl?: unknown;
    activeChannel?: unknown;
    streamUrl?: unknown;
    url?: unknown;
    subtitle?: unknown;
    message?: unknown;
    replayDurationSeconds?: unknown;
    scheduledStartTime?: unknown;
    startedAt?: unknown;
    streamStartedAt?: unknown;
    streamQuality?: unknown;
    viewerCount?: unknown;
    connectionStatus?: unknown;
    connection?: unknown;
    updatedAt?: unknown;
    timestamp?: unknown;
    eventBannerUrl?: unknown;
    banner?: unknown;
    eventLogoUrl?: unknown;
    logo?: unknown;
    ads?: unknown;
    featuredVideo?: unknown;
  };
};

function parseBroadcastAds(value: unknown): BroadcastAd[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const youtubeId = firstText(row.youtubeId);
    const startsAt = firstText(row.startsAt);
    if (!youtubeId || !startsAt) return [];
    return [{
      adId: firstText(row.adId) || `${youtubeId}-${startsAt}`,
      youtubeId,
      title: firstText(row.title) || 'Sponsored message',
      placement: firstText(row.placement) === 'picture_in_picture' ? 'picture_in_picture' : 'full_screen',
      cameraId: firstText(row.cameraId) || null,
      startsAt,
      endsAt: firstText(row.endsAt) || null,
      durationSeconds: Math.max(1, toNumber(row.durationSeconds) ?? 30),
      repeatEveryMinutes: Math.max(0, toNumber(row.repeatEveryMinutes) ?? 0),
      active: parseBoolean(row.active) === true,
    } satisfies BroadcastAd];
  });
}

function parseFeaturedVideo(value: unknown): FeaturedBroadcastVideo | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const youtubeId = firstText(row.youtubeId);
  if (!youtubeId) return null;
  return {
    youtubeId,
    title: firstText(row.title) || 'Featured highlight',
    description: firstText(row.description) || null,
  };
}

function resolveActiveAd(ads: BroadcastAd[], cameraId: string | undefined, nowMs: number) {
  const eligible = ads
    .filter((ad) => {
      if (!ad.active || (ad.cameraId && ad.cameraId !== cameraId)) return false;
      const start = new Date(ad.startsAt).getTime();
      const end = ad.endsAt ? new Date(ad.endsAt).getTime() : null;
      return Number.isFinite(start) && nowMs >= start && (!end || !Number.isFinite(end) || nowMs < end);
    })
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  for (const ad of eligible) {
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(ad.startsAt).getTime()) / 1000));
    const repeatSeconds = Math.max(0, Math.floor(ad.repeatEveryMinutes * 60));
    const cycleIndex = repeatSeconds > 0 ? Math.floor(elapsed / repeatSeconds) : 0;
    const secondsIntoCycle = repeatSeconds > 0 ? elapsed % repeatSeconds : elapsed;
    if (secondsIntoCycle < ad.durationSeconds) {
      return { ad, cycleIndex, remainingSeconds: Math.max(1, Math.ceil(ad.durationSeconds - secondsIntoCycle)) };
    }
  }
  return null;
}

async function requestWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBroadcastStatus(value: unknown): BroadcastStatus {
  const normalized = firstText(value).toLowerCase();
  if (normalized === 'live' || normalized === 'streaming' || normalized === 'connected') return 'live';
  if (normalized === 'interrupted') return 'interrupted';
  if (normalized === 'scheduled' || normalized === 'upcoming') return 'scheduled';
  if (normalized === 'connecting') return 'connecting';
  if (normalized === 'ended' || normalized === 'finished') return 'ended';
  return 'offline';
}

function normalizeStatusCopy(status: BroadcastStatus): string {
  if (status === 'live') return 'LIVE NOW';
  if (status === 'ended') return 'ENDED';
  if (status === 'connecting') return 'CONNECTING';
  if (status === 'interrupted') return 'INTERRUPTED';
  if (status === 'scheduled') return 'SCHEDULED';
  return 'OFFLINE';
}

function firstText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return null;
}

function parseViewerCount(raw: Record<string, unknown>): number | null {
  const rootCount = toNumber(raw.viewerCount);
  if (rootCount !== null) return rootCount;
  const liveViewers = toNumber(raw.liveViewers);
  if (liveViewers !== null) return liveViewers;
  const activeChannel = raw.activeChannel;
  if (activeChannel && typeof activeChannel === 'object') {
    const channelRecord = activeChannel as Record<string, unknown>;
    const channelViewerCount = toNumber(channelRecord.viewerCount);
    if (channelViewerCount !== null) return channelViewerCount;
    const channelCurrentViewers = toNumber(channelRecord.currentViewers);
    if (channelCurrentViewers !== null) return channelCurrentViewers;
  }
  return null;
}

async function fetchLiveBroadcast(eventId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!eventId) return {};
  const normalizedEventId = encodeURIComponent(eventId);
  const headers = {
    Accept: 'application/json',
  };

  const endpoint = `${LIVE_BROADCAST_BASE_URL}${RACEUPSHOT_BROADCAST_PATH.replace('{eventId}', normalizedEventId)}`;
  const response = await requestWithTimeout(
    endpoint,
    {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal,
    },
    6000,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json().catch(() => null)) as RawLiveBroadcastResponse | null;
  if (!payload || payload.success !== true || typeof payload.data !== 'object' || payload.data === null) {
    throw new Error('Invalid Race Upshot broadcast payload');
  }
  return payload.data as Record<string, unknown>;
}

type CurrentWeather = {
  temperatureC: number;
  humidity: number | null;
  windKph: number | null;
  weatherCode: number | null;
};

async function fetchCurrentWeather(location: string, signal?: AbortSignal): Promise<CurrentWeather | null> {
  if (!location.trim()) return null;
  const ignoredWords = new Set(['south', 'north', 'east', 'west', 'road', 'venue', 'india']);
  const fallbackWords = location
    .split(/[^a-zA-Z]+/)
    .reverse()
    .filter((word) => word.length >= 4 && !ignoredWords.has(word.toLowerCase()));
  const candidates = [location, ...new Set(fallbackWords)].slice(0, 6);
  let latitude: number | null = null;
  let longitude: number | null = null;

  for (const candidate of candidates) {
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=1&language=en&format=json`;
    const geocodeResponse = await requestWithTimeout(geocodeUrl, { headers: { Accept: 'application/json' }, signal }, 6000);
    if (!geocodeResponse.ok) continue;
    const geocode = await geocodeResponse.json() as { results?: { latitude?: unknown; longitude?: unknown }[] };
    latitude = toNumber(geocode.results?.[0]?.latitude);
    longitude = toNumber(geocode.results?.[0]?.longitude);
    if (latitude !== null && longitude !== null) break;
  }
  if (latitude === null || longitude === null) return null;

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
  const forecastResponse = await requestWithTimeout(forecastUrl, { headers: { Accept: 'application/json' }, signal }, 6000);
  if (!forecastResponse.ok) throw new Error(`Current weather HTTP ${forecastResponse.status}`);
  const forecast = await forecastResponse.json() as { current?: Record<string, unknown> };
  const temperatureC = toNumber(forecast.current?.temperature_2m);
  if (temperatureC === null) return null;
  return {
    temperatureC,
    humidity: toNumber(forecast.current?.relative_humidity_2m),
    windKph: toNumber(forecast.current?.wind_speed_10m),
    weatherCode: toNumber(forecast.current?.weather_code),
  };
}

function weatherCondition(code: number | null): string {
  if (code === null) return 'Current conditions';
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Current conditions';
}

function formatCurrentWeather(weather: CurrentWeather | null | undefined): string | null {
  if (!weather) return null;
  const details = [`${weatherCondition(weather.weatherCode)} · ${Math.round(weather.temperatureC)}°C`];
  if (weather.humidity !== null) details.push(`${Math.round(weather.humidity)}% humidity`);
  if (weather.windKph !== null) details.push(`${Math.round(weather.windKph)} km/h wind`);
  return details.join(' · ');
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeImageUrl(value: unknown): string | null {
  const text = firstText(value);
  if (!text || text === '[object Object]') return null;
  return text;
}

function formatDistance(meters: unknown): string {
  const value = toNumber(meters);
  if (value === null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function formatSeconds(value: unknown): string {
  const raw = toNumber(value);
  if (raw === null || raw <= 0 || !Number.isFinite(raw)) return '—';
  const total = Math.max(0, Math.round(raw));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusCopy(status: BroadcastStatus): string {
  return normalizeStatusCopy(status);
}

function formatAthleteStatus(status = '', etaSeconds: unknown): string {
  const normalized = status.toLowerCase();
  if (normalized === 'at_finish_line' || normalized.includes('at finish') || normalized.includes('finish line')) return 'At Finish Line';
  if (normalized === 'finished' || normalized.includes('finish') || normalized.includes('final')) return 'Finished';
  if (normalized === 'withdrawn') return 'Withdrawn';
  if (normalized === 'approaching' || toNumber(etaSeconds) !== null) return 'Approaching Finish';
  return 'Approaching Finish';
}

// Kept as a fallback while the simplified player rolls out across native builds.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function broadcastPlayerHtml(args: {
  url: string;
  poster?: string | null;
  mode: Exclude<PlayerMode, 'offline'>;
  eventTitle: string;
  broadcastTitle: string;
  eventName: string;
  cameraName: string | null;
  viewerCount: number | null;
  streamQuality: string | null;
  scheduleCopy: string | null;
}) {
  const config = JSON.stringify({
    url: args.url,
    poster: args.poster ?? null,
    mode: args.mode,
    eventTitle: args.eventTitle,
    broadcastTitle: args.broadcastTitle,
    eventName: args.eventName,
    cameraName: args.cameraName || 'Primary Camera',
    viewerCount: args.viewerCount,
    streamQuality: args.streamQuality || 'HD',
    scheduleCopy: args.scheduleCopy,
  });
  return `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root { --berg-blue: #2a88ff; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            background: #020408;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          #player-wrap {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #020408;
            color: #fff;
          }
          #player {
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #020408;
          }
          #overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 12px;
            pointer-events: none;
            background: linear-gradient(180deg, rgba(0, 0, 0, 0.7), rgba(0,0,0,0.1) 45%, rgba(0,0,0,0.38));
          }
          .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
          .top { align-items: flex-start; }
          .meta { justify-content: center; gap: 10px; font-size: 11px; opacity: 0.95; }
          .badge {
            border: 1px solid rgba(255, 255, 255, 0.28);
            border-radius: 999px;
            background: rgba(255, 64, 64, 0.2);
            padding: 6px 12px;
            font-size: 11px;
            font-weight: 700;
            display: inline-flex;
            gap: 7px;
            align-items: center;
          }
          .badge.off { background: rgba(142, 157, 178, 0.2); border-color: rgba(142,157,178,0.45); }
          .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ff4f4f;
            animation: blink 1.1s infinite;
          }
          .badge.off .dot { background: #a0adc1; animation: none; }
          .title-box { max-width: 62vw; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0.95; }
          .quality-chip {
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 700;
          }
          .center-shell {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            opacity: 1;
            transition: opacity 240ms ease;
          }
          .control-shell {
            pointer-events: auto;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.25);
            background: rgba(5, 10, 20, 0.55);
            display: inline-flex;
            align-items: center;
            padding: 10px 12px;
            gap: 12px;
            backdrop-filter: blur(4px);
          }
          button {
            border: none;
            border-radius: 999px;
            padding: 7px 11px;
            color: #fff;
            background: rgba(255, 255, 255, 0.15);
            font-weight: 700;
            pointer-events: auto;
          }
          button.go-live {
            background: linear-gradient(90deg, #ff4f4f, #ff7070);
            box-shadow: 0 0 0 1px rgba(255, 90, 90, 0.7), 0 10px 24px rgba(255, 90, 90, 0.25);
          }
          .bottom {
            pointer-events: auto;
            margin-top: 6px;
          }
          .seek-wrap {
            position: relative;
            width: 100%;
            height: 18px;
            margin: 6px 0 4px;
          }
          .seek-track {
            position: absolute;
            inset: 0;
            height: 6px;
            border-radius: 4px;
            background: rgba(255,255,255,0.24);
            top: 6px;
          }
          .seek-buffer {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            background: rgba(130, 177, 255, 0.4);
            border-radius: 4px;
            width: 0%;
          }
          input[type="range"] {
            -webkit-appearance: none;
            appearance: none;
            position: absolute;
            inset: 0;
            margin: 0;
            background: transparent;
            z-index: 2;
          }
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 2px solid var(--berg-blue);
            background: #fff;
            margin-top: -4px;
          }
          .time-row, .action-row, .toolbar {
            display: flex;
            gap: 8px;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
          }
          .toolbar {
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
          }
          .group { display: inline-flex; gap: 6px; align-items: center; }
          .mini {
            font-size: 11px;
            background: rgba(255,255,255,0.16);
            padding: 6px 8px;
          }
          select {
            border: none;
            border-radius: 999px;
            padding: 6px 8px;
            color: #fff;
            background: rgba(255,255,255,0.16);
          }
          #behindText { text-align: center; opacity: 0.94; min-height: 16px; font-size: 11px; }
          #goLiveFloat { position: absolute; left: 50%; transform: translateX(-50%); bottom: 96px; opacity: 0; transition: opacity 240ms ease; }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.2; }
          }
        </style>
      </head>
      <body>
        <div id="player-wrap">
          <video id="player" playsinline webkit-playsinline preload="metadata" style="width:100%;height:100%;background:#020408"></video>
          <div id="overlay">
            <div class="row top">
              <div class="badge" id="liveBadge"><span class="dot"></span><span id="liveLabel">LIVE NOW</span></div>
              <span class="quality-chip" id="qualityBadge">HD</span>
            </div>
            <div class="title-box" id="titleBox"></div>
            <div class="row meta">
              <span id="cameraName">Primary Camera</span>
              <span>·</span>
              <span id="viewerCount">Viewers: —</span>
              <span>·</span>
              <span id="connStatus">Stable</span>
            </div>
            <div class="center-shell" id="centerShell">
              <div class="control-shell">
                <button id="rewind">⏪ 10s</button>
                <button id="playPause">▶</button>
                <button id="forward">⏩ 10s</button>
              </div>
            </div>
            <div id="goLiveFloat">
              <button class="go-live" id="goLiveFloatBtn">GO LIVE</button>
            </div>
            <div class="bottom">
              <div id="behindText"></div>
              <div class="time-row">
                <span id="currentTime">00:00</span>
                <span id="stateLabel">LIVE</span>
                <span id="totalTime">00:00</span>
              </div>
              <div class="seek-wrap">
                <div class="seek-track">
                  <div id="bufferBar" class="seek-buffer"></div>
                  <input id="seek" type="range" min="0" max="1000" value="0" step="1" />
                </div>
              </div>
              <div class="action-row" style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:8px">
                <button class="go-live mini" id="goLiveBtn">GO LIVE</button>
                <button class="mini" id="playPauseBtn">Play/Pause</button>
                <button class="mini" id="replayBtn">Replay</button>
                <button class="mini" data-speed="0.5">0.5x</button>
                <button class="mini" data-speed="1">1x</button>
                <button class="mini" data-speed="1.25">1.25x</button>
                <button class="mini" data-speed="1.5">1.5x</button>
                <button class="mini" data-speed="2">2x</button>
                <select class="mini" id="qualitySelect">
                  <option value="auto">Auto</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                  <option value="360p">360p</option>
                </select>
                <button class="mini" id="muteBtn">Mute</button>
                <input class="mini" id="volume" type="range" min="0" max="1" step="0.05" value="1" style="width:90px" />
                <button class="mini" id="pipBtn">PiP</button>
                <button class="mini" id="fullscreenBtn">Fullscreen</button>
              </div>
            </div>
          </div>
        </div>
        <script>
          const cfg = ${config};
          const video = document.getElementById('player');
          const overlay = document.getElementById('overlay');
          const centerShell = document.getElementById('centerShell');
          const liveBadge = document.getElementById('liveBadge');
          const liveLabel = document.getElementById('liveLabel');
          const qualityBadge = document.getElementById('qualityBadge');
          const titleBox = document.getElementById('titleBox');
          const cameraName = document.getElementById('cameraName');
          const viewerCount = document.getElementById('viewerCount');
          const connStatus = document.getElementById('connStatus');
          const behindText = document.getElementById('behindText');
          const stateLabel = document.getElementById('stateLabel');
          const currentTime = document.getElementById('currentTime');
          const totalTime = document.getElementById('totalTime');
          const seek = document.getElementById('seek');
          const bufferBar = document.getElementById('bufferBar');
          const playPause = document.getElementById('playPause');
          const rewind = document.getElementById('rewind');
          const forward = document.getElementById('forward');
          const goLiveBtn = document.getElementById('goLiveBtn');
          const playPauseBtn = document.getElementById('playPauseBtn');
          const goLiveFloatBtn = document.getElementById('goLiveFloatBtn');
          const goLiveFloat = document.getElementById('goLiveFloat');
          const replayBtn = document.getElementById('replayBtn');
          const qualitySelect = document.getElementById('qualitySelect');
          const muteBtn = document.getElementById('muteBtn');
          const volume = document.getElementById('volume');
          const pipBtn = document.getElementById('pipBtn');
          const fullscreenBtn = document.getElementById('fullscreenBtn');
          const speedButtons = Array.from(document.querySelectorAll('[data-speed]'));
          let controlsVisible = true;
          let hideControlsTimeout = null;
          let isLive = cfg.mode === 'live';
          let lastTapAt = 0;
          let lastTapX = 0;
          let singleTapTimer = null;

          const pad = (v) => String(Math.max(0, Math.floor(v))).padStart(2, '0');
          const toTime = (sec) => {
            const s = Math.max(0, Math.floor(sec || 0));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const secPart = s % 60;
            if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(secPart);
            return pad(m) + ':' + pad(secPart);
          };
          const post = (payload) => {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }
          };
          const seekBounds = () => {
            let start = 0;
            let end = Number(video.duration || 0);
            if (video.seekable && video.seekable.length) {
              const i = video.seekable.length - 1;
              start = Number(video.seekable.start(i) || 0);
              end = Number(video.seekable.end(i) || 0);
            }
            if (!Number.isFinite(end) || end <= start) {
              end = Number(video.duration || 0);
              start = 0;
            }
            return { start, end };
          };
          const updateMeta = () => {
            titleBox.textContent = cfg.eventName + ' · ' + (cfg.eventTitle || cfg.broadcastTitle || '');
            qualityBadge.textContent = cfg.streamQuality || 'HD';
            cameraName.textContent = cfg.cameraName || 'Primary Camera';
            viewerCount.textContent = 'Viewers: ' + (cfg.viewerCount != null ? cfg.viewerCount : '—');
            connStatus.textContent = 'Stable';
            if (isLive) {
              liveLabel.textContent = 'LIVE NOW';
              liveBadge.classList.remove('off');
            } else {
              liveLabel.textContent = 'OFFLINE';
              liveBadge.classList.add('off');
            }
          };
          const setControlsVisible = (visible) => {
            controlsVisible = visible;
            overlay.style.opacity = visible ? '1' : '0';
            centerShell.style.opacity = visible ? '1' : '0';
            if (visible) {
              if (hideControlsTimeout) clearTimeout(hideControlsTimeout);
              hideControlsTimeout = setTimeout(() => setControlsVisible(false), 3000);
            }
          };
          const jumpToLive = () => {
            if (!isLive) return;
            const { end } = seekBounds();
            if (end > 0) {
              video.currentTime = Math.max(0, end - 0.1);
              video.play().catch(() => {});
            }
          };
          const seekBy = (seconds) => {
            const { start, end } = seekBounds();
            const base = Number(video.currentTime || 0);
            video.currentTime = Math.max(start, Math.min(end - 0.05, base + seconds));
          };
          const seekProgress = (value) => {
            const { start, end } = seekBounds();
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
            video.currentTime = start + ((value / 1000) * (end - start));
          };
          const update = () => {
            const { start, end } = seekBounds();
            const dur = Math.max(0, end - start);
            const now = Number(video.currentTime || 0);
            const percent = dur > 0 ? Math.min(1000, ((now - start) / dur) * 1000) : 0;
            const bufferedEnd = video.buffered && video.buffered.length ? video.buffered.end(video.buffered.length - 1) : now;
            const buffered = dur > 0 ? Math.min(1000, ((bufferedEnd - start) / dur) * 1000) : 0;
            seek.value = String(Math.max(0, Math.min(1000, Math.floor(percent))));
            bufferBar.style.width = Math.max(0, Math.min(100, buffered / 10)) + '%';
            const lag = Math.max(0, end - now);
            currentTime.textContent = toTime(now);
            totalTime.textContent = isLive ? 'LIVE' : toTime(dur);
            if (isLive) {
              stateLabel.textContent = lag > 1.2 ? 'Behind' : 'LIVE';
              if (lag > 1.2) {
                behindText.textContent = toTime(lag) + ' behind LIVE';
                liveBadge.classList.add('off');
                goLiveBtn.style.display = 'inline-flex';
                goLiveFloat.style.opacity = '1';
              } else {
                behindText.textContent = 'Live now';
                liveBadge.classList.remove('off');
                goLiveBtn.style.display = 'none';
                goLiveFloat.style.opacity = '0';
              }
            } else {
              behindText.textContent = '';
              goLiveBtn.style.display = 'none';
              goLiveFloat.style.opacity = '0';
            }
          };

          video.src = cfg.url;
          video.poster = cfg.poster || '';
          video.controls = false;

          playPause.addEventListener('click', () => {
            if (video.paused) {
              video.play().catch(() => {});
              playPause.textContent = '⏸';
              post({ command: 'play' });
            } else {
              video.pause();
              playPause.textContent = '▶';
              post({ command: 'pause' });
            }
          });
          playPauseBtn.addEventListener('click', () => {
            playPause.click();
          });
          rewind.addEventListener('click', () => { seekBy(-10); post({ command: 'seekBy', seconds: -10 }); });
          forward.addEventListener('click', () => { seekBy(10); post({ command: 'seekBy', seconds: 10 }); });
          goLiveBtn.addEventListener('click', jumpToLive);
          goLiveFloatBtn.addEventListener('click', jumpToLive);
          replayBtn.addEventListener('click', () => post({ command: 'replay' }));
          seek.addEventListener('input', (evt) => {
            seekProgress(Number(evt.target.value || 0));
            post({ command: 'seek', percent: evt.target.value });
          });
          seek.addEventListener('change', () => post({ command: 'seeked' }));
          muteBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            muteBtn.textContent = video.muted ? 'Unmute' : 'Mute';
          });
          volume.addEventListener('input', (evt) => {
            const value = Number(evt.target.value || 0);
            video.volume = value;
            post({ command: 'volume', volume: value });
          });
          speedButtons.forEach((btn) => btn.addEventListener('click', () => {
            const value = Number(btn.getAttribute('data-speed') || '1');
            video.playbackRate = value;
            post({ command: 'speed', speed: value });
          }));
          qualitySelect.addEventListener('change', (evt) => {
            qualityBadge.textContent = evt.target.value;
            post({ command: 'quality', value: evt.target.value });
          });
          pipBtn.addEventListener('click', () => {
            if (document.pictureInPictureEnabled && document.pictureInPictureElement !== video) {
              video.requestPictureInPicture && video.requestPictureInPicture().catch(() => {});
            }
          });
          fullscreenBtn.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
            else document.getElementById('player-wrap').requestFullscreen && document.getElementById('player-wrap').requestFullscreen().catch(() => {});
          });

          const wrap = document.getElementById('player-wrap');
          wrap.addEventListener('pointerup', (evt) => {
            const now = Date.now();
            const x = evt.clientX || 0;
            const isDouble = now - lastTapAt < 280 && Math.abs(x - lastTapX) < 110;
            lastTapAt = now;
            lastTapX = x;
            if (isDouble) {
              if (singleTapTimer) clearTimeout(singleTapTimer);
              if (x < window.innerWidth / 2) seekBy(-10); else seekBy(10);
              post({ command: 'seekBy', seconds: x < window.innerWidth / 2 ? -10 : 10 });
              return;
            }
            if (singleTapTimer) clearTimeout(singleTapTimer);
            singleTapTimer = setTimeout(() => setControlsVisible(!controlsVisible), 240);
          });

          let pinchDistance = null;
          wrap.addEventListener('touchstart', (evt) => {
            if (evt.touches?.length === 2) {
              const p0 = evt.touches[0];
              const p1 = evt.touches[1];
              pinchDistance = Math.hypot(p0.clientX - p1.clientX, p0.clientY - p1.clientY);
            }
          }, { passive: true });
          wrap.addEventListener('touchmove', (evt) => {
            if (!pinchDistance || evt.touches?.length !== 2) return;
            const p0 = evt.touches[0];
            const p1 = evt.touches[1];
            const next = Math.hypot(p0.clientX - p1.clientX, p0.clientY - p1.clientY);
            if (Math.abs(next - pinchDistance) / pinchDistance > 0.22 && !document.fullscreenElement) {
              document.getElementById('player-wrap').requestFullscreen && document.getElementById('player-wrap').requestFullscreen().catch(() => {});
              pinchDistance = null;
            }
          }, { passive: true });

          window.addEventListener('orientationchange', () => {
            const should = window.matchMedia('(orientation: landscape)').matches;
            if (should && !document.fullscreenElement) {
              document.getElementById('player-wrap').requestFullscreen && document.getElementById('player-wrap').requestFullscreen().catch(() => {});
            }
          });

          setControlsVisible(true);
          updateMeta();
          update();
          setInterval(update, 500);
          setInterval(() => post({ command: 'tick', currentTime: Number(video.currentTime || 0), duration: Number(video.duration || 0) }), 1200);
          video.addEventListener('loadedmetadata', () => {
            if (isLive) {
              jumpToLive();
            }
            update();
          });
          video.addEventListener('timeupdate', update);
          video.addEventListener('progress', update);

          const handleRNMessage = function (event) {
            try {
              const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
              if (!payload || typeof payload !== 'object' || !payload.command) return;
              if (payload.command === 'play') {
                video.play().catch(() => {});
              }
              if (payload.command === 'pause') {
                video.pause();
              }
              if (payload.command === 'mute') {
                video.muted = true;
              }
              if (payload.command === 'unmute') {
                video.muted = false;
              }
              if (payload.command === 'live') {
                jumpToLive();
              }
              if (payload.command === 'seek') {
                seekProgress(Number(payload.percent || 0));
              }
              if (payload.command === 'seekBy') {
                seekBy(Number(payload.seconds || 0));
              }
              if (payload.command === 'speed') {
                video.playbackRate = Number(payload.speed || 1);
              }
              if (payload.command === 'volume') {
                video.volume = Number(payload.volume || 0);
              }
              if (payload.command === 'replay') {
                video.currentTime = 0;
                video.play().catch(() => {});
              }
              if (payload.command === 'quality') {
                qualitySelect.value = String(payload.value || 'auto');
                qualityBadge.textContent = String(payload.value || 'Auto');
              }
            } catch (_) {}
          };
          document.addEventListener('message', handleRNMessage);
          window.addEventListener('message', handleRNMessage);
        </script>
      </body>
    </html>
  `;
}

function simpleLivePlayerHtml(args: {
  url: string;
  poster?: string | null;
  eventName: string;
  cameraName: string;
  quality: string;
  mode?: 'live' | 'replay';
  startedAt?: string | null;
}) {
  const config = JSON.stringify({
    url: args.url,
    poster: args.poster ?? '',
    eventName: args.eventName,
    cameraName: args.cameraName,
    quality: args.quality,
    mode: args.mode || 'live',
    startedAt: args.startedAt ?? null,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
      <style>
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #05080d; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #fff; }
        #shell { position: relative; width: 100%; height: 100%; background: #05080d; }
        video { width: 100%; height: 100%; object-fit: contain; background: #05080d; }
        #cover {
          position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between;
          padding: 16px; background: linear-gradient(180deg, rgba(3,7,12,.82), rgba(3,7,12,.26) 48%, rgba(3,7,12,.88));
        }
        .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .live { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 999px; background: #df2f36; font-size: 12px; font-weight: 800; letter-spacing: .8px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: pulse 1.2s infinite; }
        .quality { padding: 6px 10px; border: 1px solid rgba(255,255,255,.35); border-radius: 999px; font-size: 11px; font-weight: 700; }
        .center { position: absolute; inset: 0; display: grid; place-items: center; }
        #play {
          min-width: 138px; min-height: 58px; border: 0; border-radius: 999px; padding: 0 22px;
          display: inline-flex; align-items: center; justify-content: center; gap: 11px; color: #081018;
          background: #f4c542; box-shadow: 0 14px 38px rgba(0,0,0,.45); font-size: 16px; font-weight: 850;
        }
        .triangle { width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent; border-left: 13px solid #081018; }
        #spinner { display: none; width: 26px; height: 26px; border: 3px solid rgba(8,16,24,.25); border-top-color: #081018; border-radius: 50%; animation: spin .8s linear infinite; }
        .bottom strong { display: block; max-width: 90%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 15px; }
        .bottom span { display: block; margin-top: 5px; color: rgba(255,255,255,.75); font-size: 12px; }
        #message { min-height: 16px; margin-top: 7px; color: #fff; font-size: 12px; }
        #controls {
          position: absolute;
          inset: 0;
          display: none;
          padding: 14px;
          background: linear-gradient(180deg, rgba(2,5,10,.48), transparent 38%, rgba(2,5,10,.78));
          transition: opacity .2s ease;
          opacity: 0;
          pointer-events: none;
        }
        #controls.visible { opacity: 1; pointer-events: auto; }
        .utility { position: absolute; right: 14px; top: 14px; display: flex; gap: 8px; }
        .round { width: 42px; height: 42px; border: 1px solid rgba(255,255,255,.28); border-radius: 50%; color: #fff; background: rgba(8,12,22,.66); font-size: 17px; font-weight: 750; }
        #mute { width: auto; min-width: 96px; padding: 0 12px; border-radius: 999px; font-size: 11px; letter-spacing: .5px; }
        #mute.muted { border-color: rgba(254,202,202,.7); background: rgba(220,38,38,.92); }
        #mute.unmuted { border-color: rgba(167,243,208,.7); background: rgba(5,150,105,.92); }
        .timeline { position: absolute; left: 18px; right: 18px; bottom: 15px; }
        .timeline-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; }
        .timeline-meta strong { max-width: 55%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        #seek { width: 100%; height: 18px; margin: 0; accent-color: #f4c542; cursor: pointer; }
        .live-edge { border: 0; border-radius: 999px; padding: 6px 10px; color: #fff; background: #df2f36; font-size: 11px; font-weight: 800; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 50% { opacity: .35; } }
      </style>
    </head>
    <body>
      <div id="shell">
        <video id="video" playsinline webkit-playsinline preload="auto"></video>
        <div id="cover">
          <div class="top"><div class="live" id="modeBadge"><i class="dot"></i> LIVE</div><div class="quality" id="quality"></div></div>
          <div class="center"><button id="play" type="button"><i class="triangle" id="triangle"></i><i id="spinner"></i><span id="playLabel">Watch Live</span></button></div>
          <div class="bottom"><strong id="eventName"></strong><span id="cameraName"></span><div id="message">Tap play to load the live broadcast</div></div>
        </div>
        <div id="controls">
          <div class="utility">
            <button class="round muted" id="mute" type="button" aria-label="Live video muted. Tap to enable audio.">🔇 MUTED</button>
            <button class="round" id="fullscreen" type="button" aria-label="Fullscreen">F</button>
          </div>
          <div class="timeline">
          <div class="timeline-meta"><strong id="controlTitle"></strong><span>Live duration <span id="elapsed">00:00</span> <button class="live-edge" id="goLive" type="button">LIVE</button></span></div>
            <input id="seek" type="range" min="0" max="1000" value="1000" aria-label="Video progress" />
          </div>
        </div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
      <script>
        const cfg = ${config};
        const video = document.getElementById('video');
        const cover = document.getElementById('cover');
        const play = document.getElementById('play');
        const label = document.getElementById('playLabel');
        const spinner = document.getElementById('spinner');
        const triangle = document.getElementById('triangle');
        const message = document.getElementById('message');
        const controls = document.getElementById('controls');
        const seek = document.getElementById('seek');
        const elapsed = document.getElementById('elapsed');
        const mute = document.getElementById('mute');
        let controlsTimer = null;
        document.getElementById('quality').textContent = cfg.quality || 'HD';
        document.getElementById('modeBadge').textContent = cfg.mode === 'replay' ? 'REPLAY' : 'LIVE';
        document.getElementById('eventName').textContent = cfg.eventName || 'Race Upshot Live Broadcast';
        document.getElementById('cameraName').textContent = cfg.cameraName || 'Primary Camera';
        document.getElementById('controlTitle').textContent = cfg.eventName || 'Race Upshot Live Broadcast';
        document.getElementById('playLabel').textContent = cfg.mode === 'replay' ? 'Watch Replay' : 'Watch Live';
        document.getElementById('message').textContent = cfg.mode === 'replay'
          ? 'Tap play to load the replay'
          : 'Tap play to load the live broadcast';
        video.poster = cfg.poster;
        video.muted = true;
        video.defaultMuted = true;
        video.controls = false;
        const syncMuteState = () => {
          const muted = video.muted === true;
          mute.classList.toggle('muted', muted);
          mute.classList.toggle('unmuted', !muted);
          mute.textContent = muted ? '🔇 MUTED' : '🔊 UNMUTED';
          mute.setAttribute('aria-label', muted ? 'Live video muted. Tap to enable audio.' : 'Live video unmuted. Tap to mute.');
        };
        syncMuteState();
        const post = (value) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(value));
        let sourceReady = false;
        let hls = null;
        const prepareSource = () => new Promise((resolve, reject) => {
          if (sourceReady) { resolve(); return; }
          const timeout = setTimeout(() => reject(new Error('Stream loading timed out')), 12000);
          const ready = () => {
            clearTimeout(timeout);
            sourceReady = true;
            resolve();
          };
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = cfg.url;
            if (video.readyState >= 1) ready();
            else video.addEventListener('loadedmetadata', ready, { once: true });
            video.load();
            return;
          }
          if (window.Hls && window.Hls.isSupported()) {
            hls = new window.Hls({
              liveSyncDurationCount: cfg.mode === 'replay' ? undefined : 3,
              lowLatencyMode: cfg.mode !== 'replay',
              startLevel: -1,
              capLevelToPlayerSize: true,
              testBandwidth: true,
              abrEwmaDefaultEstimate: cfg.mode === 'replay' ? 5000000 : 1500000,
              maxBufferLength: cfg.mode === 'replay' ? 60 : 12,
              maxMaxBufferLength: cfg.mode === 'replay' ? 120 : 30
            });
            hls.on(window.Hls.Events.MANIFEST_PARSED, ready);
            hls.on(window.Hls.Events.ERROR, (_, data) => {
              if (data && data.fatal) {
                clearTimeout(timeout);
                sourceReady = false;
                reject(new Error(data.details || 'HLS playback error'));
              }
            });
            hls.loadSource(cfg.url);
            hls.attachMedia(video);
            return;
          }
          video.src = cfg.url;
          video.addEventListener('loadedmetadata', ready, { once: true });
          video.addEventListener('error', () => reject(new Error('Unsupported stream')), { once: true });
          video.load();
        });
        const loading = (active, text) => {
          spinner.style.display = active ? 'block' : 'none';
          triangle.style.display = active ? 'none' : 'block';
          label.textContent = text;
          play.disabled = active;
        };
        const start = async () => {
          loading(true, 'Loading');
          message.textContent = 'Connecting to the live camera...';
          try {
            await prepareSource();
            await video.play();
            video.controls = false;
            cover.style.display = 'none';
          controls.style.display = 'block';
          controls.classList.add('visible');
          showControls();
          post({ type: 'playing' });
          } catch (error) {
            sourceReady = false;
            if (hls) { hls.destroy(); hls = null; }
            loading(false, 'Try Again');
            message.textContent = 'Playback could not start. Tap to retry.';
            post({ type: 'error', message: 'Live playback could not start. Please retry.' });
          }
        };
        play.addEventListener('click', start);
        const bounds = () => {
          if (video.seekable && video.seekable.length) {
            const index = video.seekable.length - 1;
            return { start: video.seekable.start(index), end: video.seekable.end(index) };
          }
          return { start: 0, end: Number(video.duration || 0) };
        };
        const formatTime = (seconds) => {
          const value = Math.max(0, Math.floor(seconds || 0));
          return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
        };
        const liveStartedAtMs = cfg.startedAt ? Date.parse(cfg.startedAt) : NaN;
        const updateTimeline = () => {
          const range = bounds();
          const duration = range.end - range.start;
          const current = Number(video.currentTime || 0);
          seek.value = String(duration > 0 ? Math.max(0, Math.min(1000, ((current - range.start) / duration) * 1000)) : 1000);
          if (cfg.mode === 'live' && Number.isFinite(liveStartedAtMs)) {
            elapsed.textContent = formatTime((Date.now() - liveStartedAtMs) / 1000);
          } else if (cfg.mode === 'live') {
            elapsed.textContent = '—';
          } else {
            elapsed.textContent = formatTime(current - range.start);
          }
        };
        const showControls = () => {
          controls.style.display = 'block';
          controls.classList.add('visible');
          if (controlsTimer) clearTimeout(controlsTimer);
          controlsTimer = setTimeout(() => {
            if (!video.paused) {
              controls.classList.remove('visible');
            }
          }, 3000);
        };
        seek.addEventListener('input', () => { const r = bounds(); if (r.end > r.start) video.currentTime = r.start + (Number(seek.value) / 1000) * (r.end - r.start); });
        document.getElementById('goLive').addEventListener('click', () => { const r = bounds(); video.currentTime = Math.max(r.start, r.end - .2); video.play(); showControls(); });
        mute.addEventListener('click', () => { video.muted = !video.muted; syncMuteState(); if (!video.muted) video.play().catch(() => {}); showControls(); });
        video.addEventListener('volumechange', syncMuteState);
        document.getElementById('fullscreen').addEventListener('click', () => {
          if (video.webkitEnterFullscreen) {
            try {
              video.webkitEnterFullscreen();
              return;
            } catch (_) {}
          }
          const shell = document.getElementById('shell');
          if (document.fullscreenElement) document.exitFullscreen?.();
          else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {});
        });
        controls.addEventListener('click', showControls);
        controls.addEventListener('touchend', showControls, { passive: true });
        document.getElementById('shell').addEventListener('click', showControls);
        document.getElementById('shell').addEventListener('touchend', showControls, { passive: true });
        video.addEventListener('click', showControls);
        video.addEventListener('timeupdate', updateTimeline);
        video.addEventListener('pause', updateTimeline);
        window.addEventListener('pagehide', () => {
          if (controlsTimer) clearTimeout(controlsTimer);
          video.pause();
          video.removeAttribute('src');
          video.load();
          if (hls) { hls.destroy(); hls = null; }
        }, { once: true });
        video.addEventListener('playing', () => post({ type: 'playing' }));
        video.addEventListener('waiting', () => post({ type: 'buffering' }));
        video.addEventListener('error', () => {
          cover.style.display = 'flex';
          loading(false, 'Try Again');
          message.textContent = 'The live stream is temporarily unavailable.';
          post({ type: 'error', message: 'The live stream is temporarily unavailable.' });
        });
        const receive = (event) => {
          try {
            const value = JSON.parse(event.data);
            if (value.command === 'play') start();
            if (value.command === 'mute') { video.muted = true; syncMuteState(); }
            if (value.command === 'unmute') { video.muted = false; syncMuteState(); video.play().catch(() => {}); }
          } catch (_) {}
        };
        document.addEventListener('message', receive);
        window.addEventListener('message', receive);
        post({ type: 'ready' });
      </script>
    </body>
  </html>`;
}

function parseAthleteFromPayload(source: unknown): AthleteFeed[] {
  if (!Array.isArray(source)) return [];
  return source
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    .map((item) => ({
      id: firstText(item.id ?? item.athleteUid ?? item.bib ?? item.email),
      name: firstText(item.name ?? item.fullName ?? item.displayName),
      bib: firstText(item.bib ?? item.bibNumber ?? item.startNumber),
      discipline: firstText(item.discipline ?? item.currentDiscipline ?? item.currentLeg),
      contestName: firstText(item.contestName ?? item.contest ?? item.raceCategory),
      ageGroup: firstText(item.ageGroup ?? item.ageGroupName),
      countryFlag:
        firstText(item.countryFlag ?? item.flag) ||
        getCountryFlagEmoji(
          firstText(item.countryCode ?? item.country ?? item.countryName ?? item.nationality),
        ),
      status: firstText(item.status ?? item.state),
      estimatedSecondsToFinish: toNumber(item.estimatedSecondsToFinish ?? item.etaSeconds ?? item.eta),
      distanceRemainingMeters: toNumber(item.distanceRemainingMeters ?? item.remainingDistance),
      progress: toNumber(item.progress),
      photoUrl: normalizeImageUrl(item.photoUrl ?? item.imageUrl ?? item.profilePhotoUrl ?? item.profile_image ?? item.photoURL ?? item.avatarUrl) ?? undefined,
      profilePhotoUrl: normalizeImageUrl(item.profilePhotoUrl ?? item.avatarUrl ?? item.profile_image) ?? undefined,
      lastUpdated: firstText(item.lastUpdated ?? item.updatedAt ?? item.timestamp),
    }));
}

function normalizePayload(raw: Record<string, unknown>): BroadcastPayload {
  const status = normalizeBroadcastStatus((raw as Record<string, unknown>).status);
  const isActiveApproach = (athlete: AthleteFeed) => {
    const athleteStatus = firstText(athlete.status).toLowerCase();
    return !['finished', 'finish', 'completed', 'dnf', 'dns', 'withdrawn'].includes(athleteStatus);
  };
  const approaching = parseAthleteFromPayload((raw as Record<string, unknown>).approachingAthletes)
    .filter(isActiveApproach)
    .slice(0, 10);
  const explicitUpcoming = parseAthleteFromPayload((raw as Record<string, unknown>).upcomingAthletes)
    .filter(isActiveApproach)
    .slice(0, 10);
  const channelRaw = (raw as Record<string, unknown>).activeChannel
    ?? (raw as Record<string, unknown>).channel
    ?? (raw as Record<string, unknown>).currentChannel;
  const channel =
    channelRaw && typeof channelRaw === 'object'
      ? {
          id: firstText((channelRaw as Record<string, unknown>).id),
          name: firstText((channelRaw as Record<string, unknown>).name),
          type: firstText((channelRaw as Record<string, unknown>).type),
        }
      : null;

  return {
    eventId: firstText(raw.eventId) || '',
    status,
    enabled: parseBoolean((raw as Record<string, unknown>).enabled) ?? false,
    highlightsEnabled: parseBoolean((raw as Record<string, unknown>).highlightsEnabled) ?? false,
    title: firstText(raw.title) || 'Race Upshot Live Broadcast',
    subtitle: firstText((raw as Record<string, unknown>).subtitle) || null,
    message: firstText((raw as Record<string, unknown>).message) || null,
    activeChannel: channel,
    hlsUrl: normalizeImageUrl((raw as Record<string, unknown>).hlsUrl ?? (raw as Record<string, unknown>).streamUrl ?? (raw as Record<string, unknown>).url),
    posterUrl: normalizeImageUrl((raw as Record<string, unknown>).posterUrl ?? (raw as Record<string, unknown>).poster ?? (raw as Record<string, unknown>).imageUrl),
    replayUrl: normalizeImageUrl((raw as Record<string, unknown>).replayUrl ?? (raw as Record<string, unknown>).recordingUrl),
    replayDurationSeconds: toNumber((raw as Record<string, unknown>).replayDurationSeconds),
    scheduledStartTime: firstText((raw as Record<string, unknown>).scheduledStartTime ?? (raw as Record<string, unknown>).startTime),
    startedAt: firstText((raw as Record<string, unknown>).startedAt ?? (raw as Record<string, unknown>).liveStartedAt ?? (raw as Record<string, unknown>).streamStartedAt),
    streamQuality: firstText((raw as Record<string, unknown>).streamQuality ?? (raw as Record<string, unknown>).quality),
    viewerCount: parseViewerCount(raw),
    connectionStatus: firstText((raw as Record<string, unknown>).connectionStatus ?? (raw as Record<string, unknown>).connection),
    updatedAt: firstText((raw as Record<string, unknown>).updatedAt ?? (raw as Record<string, unknown>).timestamp),
    approachingAthletes: approaching,
    upcomingAthletes: explicitUpcoming.length > 0 ? explicitUpcoming : approaching.slice(1),
    eventBannerUrl: normalizeImageUrl((raw as Record<string, unknown>).eventBannerUrl ?? (raw as Record<string, unknown>).banner),
    eventLogoUrl: normalizeImageUrl((raw as Record<string, unknown>).eventLogoUrl ?? (raw as Record<string, unknown>).logo),
    version: toNumber((raw as Record<string, unknown>).version ?? (raw as Record<string, unknown>).streamVersion) ?? 0,
    ads: parseBroadcastAds((raw as Record<string, unknown>).ads),
    featuredVideo: parseFeaturedVideo((raw as Record<string, unknown>).featuredVideo),
  };
}

function AthleteApproachCard({
  athlete,
  emphasis = false,
}: {
  athlete: AthleteFeed;
  emphasis?: boolean;
}) {
  const theme = useTheme();
  const status = formatAthleteStatus(athlete.status, athlete.estimatedSecondsToFinish);
  const distance = formatDistance(athlete.distanceRemainingMeters);
  const eta = formatSeconds(athlete.estimatedSecondsToFinish);
  const progress = Math.max(0, Math.min(1, toNumber(athlete.progress) ?? 0.35));
  const photo = athlete.photoUrl ?? athlete.profilePhotoUrl;

  return (
    <Card
      style={{
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        borderColor: emphasis ? theme.colors.accent : theme.colors.border,
        borderWidth: emphasis ? 1.5 : 1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Avatar name={athlete.name || 'Athlete'} uri={photo} size={emphasis ? 72 : 56} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="headline">
              {athlete.name || 'Athlete'}
              {athlete.bib ? ` · #${athlete.bib}` : ''}
            </Text>
            <Text variant="label" color="textPrimary">{athlete.countryFlag || ''}</Text>
          </View>
          <Text variant="bodySmall" color="textPrimary">
            {athlete.discipline || 'Current Discipline'}
            {athlete.discipline && (athlete.contestName || athlete.ageGroup) ? ' · ' : ''}
            {athlete.contestName ? `${athlete.contestName}` : ''}
            {athlete.ageGroup ? ` · ${athlete.ageGroup}` : ''}
          </Text>
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color="textPrimary">Estimated Finish</Text>
          <Text variant="caption">{eta}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color="textPrimary">Distance Remaining</Text>
          <Text variant="caption">{distance}</Text>
        </View>
        <ProgressBar progress={progress} height={8} />
        <Text variant="bodySmall" color="textPrimary">
          Status · {status}
        </Text>
      </View>
    </Card>
  );
}

function AthleteStrip({
  athletes,
  emptyCopy,
  emptyCopyColor,
  emptyCardColor,
  emptyCardRadius,
  emptyCardBackground,
}: {
  athletes: AthleteFeed[];
  emptyCopy: string;
  emptyCopyColor?: string;
  emptyCardColor?: string;
  emptyCardRadius?: number;
  emptyCardBackground?: string;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensionsRN();
  const cardWidth = width > 760 ? 300 : 270;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
      {athletes.length > 0 ? (
        athletes.map((athlete) => (
          <Animated.View key={`${athlete.id ?? athlete.bib}-${athlete.name}`} entering={FadeIn.duration(180)}>
            <Card
              style={{
                width: cardWidth,
                gap: 8,
                padding: theme.spacing.md,
                borderColor: 'rgba(255,255,255,0.14)',
                borderWidth: 1,
              }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="title">{athlete.name || 'Athlete'}{athlete.bib ? ` #${athlete.bib}` : ''}</Text>
                <Text variant="caption" color="textPrimary">{athlete.countryFlag || ''}</Text>
              </View>
              <Text variant="bodySmall" color="textPrimary">
                ETA {formatSeconds(athlete.estimatedSecondsToFinish)} · {formatDistance(athlete.distanceRemainingMeters)}
              </Text>
              <ProgressBar progress={Math.max(0, Math.min(1, toNumber(athlete.progress) ?? 0.3))} height={6} />
            </Card>
          </Animated.View>
        ))
      ) : (
        <Card
          style={{
            width: cardWidth,
            padding: theme.spacing.md,
            backgroundColor: emptyCardBackground ?? 'rgba(255,255,255,0.04)',
            borderColor: 'rgba(255,255,255,0.16)',
            borderWidth: emptyCardBackground ? 1 : 1,
            borderRadius: emptyCardRadius ?? theme.radius.medium,
          }}>
          <Text variant="bodySmall" style={{ color: emptyCardColor ?? emptyCopyColor ?? theme.colors.textPrimary }}>
            {emptyCopy}
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

function InfoRow({
  label,
  value,
  valueStyle,
  wrap = false,
}: {
  label: string;
  value: string;
  valueStyle?: object;
  wrap?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: wrap ? 'flex-start' : 'center',
        gap: theme.spacing.sm,
        flexWrap: wrap ? 'wrap' : 'nowrap',
      }}>
      <Text variant="bodySmall" style={{ color: '#B8BFCC', flexShrink: 0 }}>
        {label}
      </Text>
      <Text
        variant="bodySmall"
        style={{
          color: '#E8ECF5',
          textAlign: 'right',
          flex: 1,
          minWidth: 0,
          ...(valueStyle ?? {}),
        }}
        numberOfLines={wrap ? 3 : 1}>
        {value}
      </Text>
    </View>
  );
}

export function EventBroadcastScreen() {
  const theme = useTheme();
  const sectionTextColor = '#FFFFFF';
  const { eventId } = useLocalSearchParams<{ eventId?: string | string[] }>();
  const normalizedEventId = safeRouteEventId(Array.isArray(eventId) ? eventId[0] : eventId) ?? '';
  const eventQuery = useEvent(normalizedEventId);
  const { height, width } = useWindowDimensionsRN();
  const playerHeight = Math.max(240, Math.floor(Math.min(height * 0.44, 520)));
  const webViewRef = useRef<NativeWebView | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerRetryToken, setPlayerRetryToken] = useState(0);
  const [isBroadcastRefreshing, setIsBroadcastRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [adMuted, setAdMuted] = useState(false);
  const [highlightMuted, setHighlightMuted] = useState(false);
  const event = eventQuery.event;
  const weatherLocation = event?.location || event?.name || '';

  const weatherQuery = useQuery({
    queryKey: ['events', 'current-weather', weatherLocation],
    queryFn: ({ signal }) => fetchCurrentWeather(weatherLocation, signal),
    enabled: Boolean(weatherLocation),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
    throwOnError: false,
  });

  const broadcastQuery = useQuery({
    queryKey: queryKeys.events.broadcast(normalizedEventId),
    queryFn: ({ signal }) => fetchLiveBroadcast(normalizedEventId, signal).then(normalizePayload),
    staleTime: 0,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    enabled: Boolean(normalizedEventId),
    retry: 0,
    throwOnError: false,
  });

  const payload = {
    ...EMPTY_PAYLOAD,
    ...broadcastQuery.data,
    eventId: broadcastQuery.data?.eventId || normalizedEventId || '',
  };
  const isCheckingBroadcast = broadcastQuery.isPending && !broadcastQuery.data;
  const isBroadcastUnavailable = broadcastQuery.isError && broadcastQuery.failureCount >= 3;
  const showLive = payload.enabled === true && payload.status === 'live' && Boolean(payload.hlsUrl);
  const showHighlights = payload.highlightsEnabled === true;
  const canPlayLive = showLive;
  const canPlayReplay = !canPlayLive && Boolean(payload.replayUrl);
  const playerUrl = canPlayLive ? payload.hlsUrl : (canPlayReplay ? payload.replayUrl : null);
  const playerMode: PlayerMode = canPlayLive ? 'live' : canPlayReplay ? 'replay' : 'offline';
  const isNotLive = !payload.enabled || !payload.hlsUrl;
  const activeAd = canPlayLive ? resolveActiveAd(payload.ads, payload.activeChannel?.id, nowMs) : null;
  const activeAdKey = activeAd ? `${activeAd.ad.adId}:${activeAd.cycleIndex}` : '';
  const activeAdUrl = activeAd
    ? `https://www.youtube.com/embed/${encodeURIComponent(activeAd.ad.youtubeId)}?autoplay=1&mute=${adMuted ? 1 : 0}&controls=1&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${encodeURIComponent(activeAd.ad.youtubeId)}`
    : null;
  const highlightUrl = !canPlayLive && payload.featuredVideo?.youtubeId
    ? `https://www.youtube.com/embed/${encodeURIComponent(payload.featuredVideo.youtubeId)}?autoplay=1&mute=${highlightMuted ? 1 : 0}&controls=1&rel=0&modestbranding=1&playsinline=1`
    : null;
  const adWidth = Math.min(420, Math.max(220, width * 0.52));
  const adHeight = Math.round(adWidth * 9 / 16) + 42;
  const highlightWidth = Math.min(320, Math.max(190, width * 0.66));
  const highlightHeight = Math.round(highlightWidth * 9 / 16) + 46;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const heroPoster = payload.posterUrl
    || payload.eventBannerUrl
    || event?.bannerImageUrl
    || event?.coverImageUrl
    || event?.bannerImage
    || null;

  const venue = [event?.location, event?.discipline].filter(Boolean).join(' · ') || 'Venue to be confirmed';

  const eventRecord = event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
  const weather = formatCurrentWeather(weatherQuery.data)
    || firstText(eventRecord.weather)
    || firstText(eventRecord.weatherLabel)
    || 'N/A';

  const playerVersion = `${payload.eventId}-${payload.version}-${payload.hlsUrl || ''}-${playerRetryToken}`;
  const playerPoster = heroPoster;
  const sectionLabelColor = '#B8BFCC';
  const sectionBodyColor = '#E8ECF5';
  const sectionHeadingColor = '#F5F7FB';
  const sectionPillColor = theme.colors.accent;
  const sectionCardBg = 'rgba(14,18,28,0.94)';
  const sectionBorderColor = 'rgba(255,255,255,0.14)';

  const playerHtml = (() => {
    if (!playerUrl) return null;
    const cacheKey = `${playerVersion}-${playerUrl}`;
    if (!playerHtmlCache.has(cacheKey)) {
      playerHtmlCache.set(
        cacheKey,
          simpleLivePlayerHtml({
            url: playerUrl,
            poster: playerPoster,
            eventName: event?.name || payload.eventId,
            cameraName: payload.activeChannel?.name || 'Primary Camera',
            quality: payload.streamQuality || 'HD',
            mode: playerMode === 'replay' ? 'replay' : 'live',
          startedAt: payload.startedAt,
          }),
        );
    }
    return playerHtmlCache.get(cacheKey) ?? null;
  })();

  const execute = (command: string, percent?: number) => {
    if (!webViewRef.current || !playerHtml) return;
    const payload = percent === undefined ? { command } : { command, percent };
    const message = JSON.stringify(payload);
    const escaped = JSON.stringify(message);
    const script = `(function(){window.dispatchEvent(new MessageEvent('message', { data: ${escaped} }));})();`;
    webViewRef.current.injectJavaScript(script);
  };


  useEffect(() => {
    if (!activeAdKey || !webViewRef.current || !playerHtml) return;
    const message = JSON.stringify({ command: 'mute' });
    const escaped = JSON.stringify(message);
    webViewRef.current.injectJavaScript(`(function(){window.dispatchEvent(new MessageEvent('message', { data: ${escaped} }));})();`);
  }, [activeAdKey, playerHtml]);

  const retryPlayback = () => {
    setPlayerRetryToken((value) => value + 1);
    setPlayerError(null);
    execute('play');
  };

  const handlePlayerLoaded = () => setPlayerError(null);

  if (!normalizedEventId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState title="Missing event" description="No event id was provided." onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  if (eventQuery.isLoading && !event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
          <Skeleton height={playerHeight} radius={theme.radius.xl} />
          <Skeleton height={160} radius={theme.radius.large} />
          <Skeleton height={190} radius={theme.radius.large} />
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState
          title="Could not load this event"
          description="We couldn't load this event. Please try again."
          onRetry={() => eventQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  const leadAthlete = payload.approachingAthletes[0] ?? payload.upcomingAthletes[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#080b10' }} edges={['top', 'left', 'right']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: theme.spacing.base, gap: theme.spacing.md, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isBroadcastRefreshing}
              onRefresh={() => {
                setIsBroadcastRefreshing(true);
                void broadcastQuery.refetch().finally(() => {
                  setIsBroadcastRefreshing(false);
                });
              }}
              tintColor={theme.colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}>

          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(120)}
            style={{ position: 'relative', zIndex: 0 }}>
            <Card
              style={{
                borderRadius: theme.radius.xl,
                overflow: 'hidden',
                padding: 0,
                borderColor: 'rgba(255,255,255,0.22)',
                borderWidth: 1,
                height: playerHeight,
                backgroundColor: '#020408',
                position: 'relative',
                boxShadow: '0 10px 20px rgba(0,0,0,0.35)',
            }}>
            <View style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.45)',
              pointerEvents: 'none',
            }} />
            {playerHtml && playerMode !== 'offline' ? (
              Platform.OS === 'web' ? (
                createElement('iframe', {
                  key: playerVersion,
                  srcDoc: playerHtml,
                  title: `${event?.name || 'Race Upshot'} ${playerMode === 'replay' ? 'replay' : 'live broadcast'}`,
                  allow: 'autoplay; fullscreen; picture-in-picture',
                  style: {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                    backgroundColor: '#020408',
                    display: 'block',
                  },
                })
              ) : (
                <NativeWebView
                  key={playerVersion}
                  ref={webViewRef}
                  source={{ html: playerHtml }}
                  style={{ flex: 1 }}
                  onError={() => setPlayerError('Unable to initialize stream player')}
                  onLoadEnd={handlePlayerLoaded}
                  onLoadStart={() => setPlayerError(null)}
                  originWhitelist={['*']}
                  allowsFullscreenVideo
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction
                  onMessage={(event) => {
                    const text = event.nativeEvent.data;
                    if (!text) return;
                    try {
                      const parsed = JSON.parse(text);
                      if (parsed.type === 'playing' || parsed.type === 'ready') {
                        setPlayerError(null);
                      } else if (typeof parsed.message === 'string' && parsed.message) {
                        setPlayerError(parsed.message);
                      } else if (parsed.type === 'error' && typeof parsed.message === 'string') {
                        setPlayerError(parsed.message);
                      }
                    } catch (_parseError) {
                      // Keep compatibility with legacy numeric status payloads.
                      void _parseError;
                      const parsed = Number(text);
                      if (!Number.isFinite(parsed)) return;
                    }
                  }}
                />
              )
            ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.base, gap: theme.spacing.sm }}>
                <View style={{
                  width: '100%',
                  flex: 1,
                  borderRadius: theme.radius.large,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.2)',
                  padding: theme.spacing.md,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                }}>
                <Text variant="headline" style={{ color: sectionTextColor, textAlign: 'center' }}>
                  {isCheckingBroadcast
                    ? 'Checking live broadcast'
                    : isBroadcastUnavailable
                      ? 'Broadcast unavailable'
                      : 'Broadcast not live yet'}
                </Text>
                <Text variant="body" style={{ color: sectionTextColor, textAlign: 'center' }}>
                  {isCheckingBroadcast
                    ? 'Connecting to the broadcast service...'
                    : isBroadcastUnavailable
                    ? 'Unable to refresh broadcast state right now.'
                    : isNotLive
                      ? 'The broadcast is not live yet.'
                      : payload.status === 'connecting'
                        ? 'Connecting to live source.'
                        : payload.status === 'interrupted'
                          ? 'Live source is temporarily interrupted.'
                          : 'Broadcast is currently not available.'}
                </Text>
                <View style={{ marginTop: theme.spacing.md, alignSelf: 'center', minWidth: 140 }}>
                  <Button
                    label="GO LIVE"
                    onPress={() => {
                      setIsBroadcastRefreshing(true);
                      void broadcastQuery.refetch().finally(() => {
                        setIsBroadcastRefreshing(false);
                      });
                    }}
                    fullWidth
                  />
                </View>
                <Text variant="bodySmall" style={{ color: '#fff', opacity: 0.72, textAlign: 'center', marginTop: theme.spacing.sm }}>
                  Live controls appear once the broadcast starts.
                </Text>
                  {isBroadcastUnavailable ? (
                <Text variant="bodySmall" color="textPrimary" style={{ color: sectionTextColor, marginTop: theme.spacing.sm }}>
                  Pull down to retry once network recovers.
                </Text>
                  ) : null}
                </View>
              </View>
            )}
            {playerError ? (
              <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
                <Text variant="bodySmall" color="textPrimary" style={{ color: '#fff', opacity: 0.93, marginBottom: theme.spacing.xs }}>
                  {playerError}
                </Text>
                <Text variant="bodySmall" color="textPrimary" style={{ color: '#fff', opacity: 0.8, marginBottom: theme.spacing.xs }}>
                  Tap retry to attempt playback again.
                </Text>
                <Button
                  label="Retry"
                  onPress={retryPlayback}
                />
              </View>
        ) : null}
            {highlightUrl && payload.featuredVideo ? (
              <View style={{ position: 'absolute', zIndex: 20, left: 10, top: 10, width: highlightWidth, height: highlightHeight, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(75,220,235,0.55)', backgroundColor: '#03060B' }}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                  {Platform.OS === 'web'
                    ? createElement('iframe', {
                        key: `${payload.featuredVideo.youtubeId}-${highlightMuted ? 'muted' : 'sound'}`,
                        src: highlightUrl,
                        title: payload.featuredVideo.title,
                        allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
                        style: { width: '100%', height: '100%', border: 0, backgroundColor: '#000' },
                      })
                    : <NativeWebView
                        key={`${payload.featuredVideo.youtubeId}-${highlightMuted ? 'muted' : 'sound'}`}
                        source={{ uri: highlightUrl }}
                        style={{ flex: 1, backgroundColor: '#000' }}
                        originWhitelist={['*']}
                        allowsFullscreenVideo
                        allowsInlineMediaPlayback
                        mediaPlaybackRequiresUserAction={false}
                      />}
                </View>
                <View style={{ height: 46, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="caption" style={{ color: '#67E8F9', fontWeight: '800' }}>FEATURED HIGHLIGHT</Text>
                    <Text variant="bodySmall" style={{ color: '#FFF' }} numberOfLines={1}>{payload.featuredVideo.title}</Text>
                  </View>
                  <Button label={highlightMuted ? 'Unmute' : 'Mute'} onPress={() => setHighlightMuted((value) => !value)} />
                </View>
              </View>
            ) : null}
            {activeAd && activeAdUrl ? (
              <View
                style={activeAd.ad.placement === 'picture_in_picture'
                  ? { position: 'absolute', zIndex: 30, right: 10, bottom: 10, width: adWidth, height: adHeight, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#F5C842', backgroundColor: '#000' }
                  : { position: 'absolute', zIndex: 30, inset: 0, backgroundColor: '#000' }}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                  {Platform.OS === 'web'
                    ? createElement('iframe', {
                        key: `${activeAd.ad.adId}-${activeAd.cycleIndex}-${adMuted ? 'muted' : 'sound'}`,
                        src: activeAdUrl,
                        title: activeAd.ad.title,
                        allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
                        style: { width: '100%', height: '100%', border: 0, backgroundColor: '#000' },
                      })
                    : <NativeWebView
                        key={`${activeAd.ad.adId}-${activeAd.cycleIndex}-${adMuted ? 'muted' : 'sound'}`}
                        source={{ uri: activeAdUrl }}
                        style={{ flex: 1, backgroundColor: '#000' }}
                        originWhitelist={['*']}
                        allowsFullscreenVideo
                        allowsInlineMediaPlayback
                        mediaPlaybackRequiresUserAction={false}
                      />}
                </View>
                <View style={{ height: 42, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(245,200,66,0.35)' }}>
                  <Text variant="caption" style={{ color: '#F5C842', flex: 1 }} numberOfLines={1}>ADVERTISEMENT · {activeAd.ad.title} · {activeAd.remainingSeconds}s</Text>
                  <Button label={adMuted ? 'Unmute' : 'Mute'} onPress={() => setAdMuted((value) => !value)} />
                </View>
              </View>
            ) : null}
            </Card>

            {showHighlights ? (
            <Animated.View entering={FadeIn.duration(170)}>
              <View style={{ marginBottom: theme.spacing.md }}>
                <View style={{ marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="headline" style={{ color: sectionHeadingColor, letterSpacing: 0.2 }}>Highlights</Text>
                  <View style={{ backgroundColor: sectionPillColor, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, opacity: 0.9 }}>
                    <Text variant="caption" style={{ color: sectionTextColor, fontWeight: '700' }}>LIVE HIGHLIGHTS</Text>
                  </View>
                </View>
                <Text variant="bodySmall" style={{ color: sectionLabelColor, marginBottom: theme.spacing.xs }}>
                  Live approach feed for upcoming athletes.
                </Text>
              </View>
              {payload.approachingAthletes.length > 0 ? (
                <AthleteStrip
                  athletes={payload.approachingAthletes}
                  emptyCopy="No athlete feed updates yet."
                  emptyCopyColor="#000000"
                  emptyCardColor="#000000"
                  emptyCardBackground="#f8f9fb"
                  emptyCardRadius={theme.radius.medium}
                />
              ) : (
                <Card
                  style={{
                    marginTop: theme.spacing.sm,
                    padding: theme.spacing.md,
                    backgroundColor: sectionCardBg,
                    borderColor: sectionBorderColor,
                    borderWidth: 1,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: '#000000' }}>
                    No athlete feed updates yet.
                  </Text>
                </Card>
              )}
            </Animated.View>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeIn.duration(170)} style={{ position: 'relative', zIndex: 2 }}>
            <View style={{ marginTop: theme.spacing.xs }}>
              <Text variant="headline" style={{ color: sectionHeadingColor, letterSpacing: 0.2 }}>Athlete Approaching Finish</Text>
            </View>
            <Text variant="bodySmall" style={{ color: sectionLabelColor, marginTop: 6, marginBottom: 8 }}>
              Updated from live athlete telemetry.
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              {leadAthlete ? (
                <AthleteApproachCard athlete={leadAthlete} emphasis />
              ) : (
                <Card
                  style={{
                    padding: theme.spacing.md,
                    gap: 6,
                    backgroundColor: '#F3F5FA',
                    borderColor: '#D9DFEA',
                    borderWidth: 1,
                    borderRadius: theme.radius.large,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: '#000000', fontWeight: '500' }}>
                    No athlete feed updates yet.
                  </Text>
                </Card>
              )}
            </View>
          </Animated.View>

          <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.sm, position: 'relative', zIndex: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text variant="headline" style={{ color: sectionHeadingColor, letterSpacing: 0.2 }}>Upcoming Athletes</Text>
            <Text variant="caption" style={{ color: sectionLabelColor }}>{payload.upcomingAthletes.length} queued</Text>
          </View>
          <AthleteStrip
            athletes={payload.upcomingAthletes}
            emptyCopy="No athlete feed updates yet."
            emptyCopyColor="#000000"
            emptyCardColor="#000000"
            emptyCardBackground="#f8f9fb"
            emptyCardRadius={theme.radius.medium}
          />
        </View>

          <Card
            style={{
              marginTop: theme.spacing.sm,
              gap: theme.spacing.sm,
              backgroundColor: sectionCardBg,
              borderColor: sectionBorderColor,
              borderWidth: 1,
              padding: theme.spacing.md,
              paddingBottom: 14,
            }}
          >
          <Text variant="headline" style={{ color: sectionHeadingColor, letterSpacing: 0.2 }}>Broadcast Information</Text>
          <View style={{ gap: 10 }}>
            <InfoRow label="Current Camera" value={`${payload.activeChannel?.name || 'Primary Camera'}${payload.activeChannel?.type ? ` (${payload.activeChannel.type})` : ''}`} wrap />
            <InfoRow label="Broadcast Status" value={statusCopy(payload.status)} />
            <InfoRow label="Last Updated" value={payload.updatedAt || '—'} wrap />
            <InfoRow label="Stream Quality" value={payload.streamQuality || 'HD'} />
            <InfoRow label="Connection" value={payload.connectionStatus || 'Stable'} />
            <InfoRow label="Live Viewers" value={String(payload.viewerCount ?? '—')} />
          </View>
        </Card>

        <Card
          style={{
            marginTop: theme.spacing.sm,
            gap: theme.spacing.sm,
            backgroundColor: sectionCardBg,
            borderColor: sectionBorderColor,
            borderWidth: 1,
            padding: theme.spacing.md,
          }}
        >
          <Text variant="headline" style={{ color: sectionHeadingColor, letterSpacing: 0.2 }}>Event Information</Text>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {payload.eventLogoUrl ? <Avatar name={event?.name || 'Race Upshot Event'} uri={payload.eventLogoUrl} size={44} /> : null}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="title" style={{ color: sectionBodyColor }} numberOfLines={2}>
                  {event?.name || 'Race Upshot Event'}
                </Text>
                <Text variant="bodySmall" style={{ color: sectionLabelColor }} numberOfLines={3}>
                  {venue}
                </Text>
              </View>
            </View>
            <InfoRow label="Date" value={event?.dateLabel || 'TBD'} />
            <InfoRow label="Weather" value={weather} wrap />
          </View>
        </Card>
      </ScrollView>

      {isBroadcastRefreshing ? (
        <View style={{ position: 'absolute', right: 16, top: 16, opacity: 0.8 }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default EventBroadcastScreen;
