import { onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import {
  compareManifestVersions,
  isCanonicalChangeEvent,
  type CanonicalChangeEvent,
} from '@raceupshot/live-tracking-contracts';

import { env } from '@/core/constants/env';
import { nextSocketReconnectDecision } from './socketReconnectPolicy';

type StreamHealth = 'degraded' | 'healthy';
type RecoveryReason = 'FOREGROUND_RECOVERY' | 'NETWORK_RECOVERY' | 'STREAM_RECOVERY';

type Consumer = {
  id: string;
  onChange: (change: CanonicalChangeEvent) => void;
  onHealth: (health: StreamHealth) => void;
  onRecovery: (reason: RecoveryReason) => void;
};

type RegistryEntry = {
  eventId: string;
  consumers: Map<string, Consumer>;
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  healthTimer: ReturnType<typeof setInterval> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  appStateSubscription: { remove: () => void };
  onlineSubscription: () => void;
  wasOnline: boolean;
  health: StreamHealth;
  lastMessageAt: number;
  latestRevision: number;
  latestManifestVersion: string | null;
  attempts: number;
  cooldownUntil: number;
  probingAfterCooldown: boolean;
  needsRecovery: boolean;
  disposed: boolean;
};

export type CanonicalChangeStreamLease = {
  release: () => void;
};

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_STALE_MS = 40_000;
const HEALTH_CHECK_MS = 5_000;
const RELEASE_GRACE_MS = 1_000;
const entries = new Map<string, RegistryEntry>();

function streamUrl(eventId: string): string {
  const base = env.mobileApiBaseUrl
    .replace(/\/$/, '')
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:');
  return `${base}/api/live/events/${encodeURIComponent(eventId)}/stream`;
}

function notifyHealth(entry: RegistryEntry, health: StreamHealth) {
  entry.health = health;
  for (const consumer of entry.consumers.values()) consumer.onHealth(health);
}

function notifyRecovery(entry: RegistryEntry, reason: RecoveryReason) {
  for (const consumer of entry.consumers.values()) consumer.onRecovery(reason);
}

function clearTransportTimers(entry: RegistryEntry) {
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  if (entry.healthTimer) clearInterval(entry.healthTimer);
  entry.heartbeatTimer = null;
  entry.healthTimer = null;
}

function detachSocket(entry: RegistryEntry, code = 1000, reason = 'Stream replaced') {
  const socket = entry.socket;
  entry.socket = null;
  clearTransportTimers(entry);
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  try { socket.close(code, reason); } catch { /* Socket may already be closed. */ }
}

function scheduleReconnect(entry: RegistryEntry) {
  if (
    entry.disposed || entry.consumers.size === 0 ||
    AppState.currentState !== 'active' || !onlineManager.isOnline()
  ) return;
  const decision = nextSocketReconnectDecision(
    entry.attempts,
    Date.now(),
    entry.probingAfterCooldown,
  );
  entry.attempts = decision.attempts;
  entry.probingAfterCooldown = false;
  const delayMs = decision.delayMs;
  if (decision.kind === 'cooldown') entry.cooldownUntil = decision.until;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    connect(entry);
  }, delayMs);
}

function acceptMessage(entry: RegistryEntry, change: CanonicalChangeEvent) {
  if (change.eventId !== entry.eventId) return;
  const revision = Number(change.revision || 0);
  const manifestComparison = compareManifestVersions(
    change.manifestVersion,
    entry.latestManifestVersion,
  );
  if (manifestComparison < 0) return;
  if (manifestComparison === 0 && revision > 0 && revision <= entry.latestRevision) return;
  if (manifestComparison === 0 && revision <= 0) return;
  if (manifestComparison > 0) entry.latestRevision = 0;
  entry.latestRevision = Math.max(entry.latestRevision, revision);
  entry.latestManifestVersion = change.manifestVersion;
  for (const consumer of entry.consumers.values()) consumer.onChange(change);
}

function markHealthy(entry: RegistryEntry) {
  entry.lastMessageAt = Date.now();
  const recovered = entry.needsRecovery;
  entry.needsRecovery = false;
  entry.attempts = 0;
  entry.cooldownUntil = 0;
  entry.probingAfterCooldown = false;
  notifyHealth(entry, 'healthy');
  if (recovered) notifyRecovery(entry, 'STREAM_RECOVERY');
}

function connect(entry: RegistryEntry) {
  if (
    entry.disposed || entry.consumers.size === 0 ||
    AppState.currentState !== 'active' || !onlineManager.isOnline()
  ) return;
  if (
    entry.socket &&
    (entry.socket.readyState === WebSocket.OPEN || entry.socket.readyState === WebSocket.CONNECTING)
  ) return;
  const now = Date.now();
  if (entry.cooldownUntil > now) {
    notifyHealth(entry, 'degraded');
    if (!entry.reconnectTimer) {
      entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null;
        entry.probingAfterCooldown = true;
        connect(entry);
      }, entry.cooldownUntil - now);
    }
    return;
  }
  if (entry.cooldownUntil > 0) entry.probingAfterCooldown = true;
  detachSocket(entry);
  const socket = new WebSocket(streamUrl(entry.eventId));
  entry.socket = socket;
  socket.onopen = () => {
    if (entry.socket !== socket || entry.disposed) return;
    entry.lastMessageAt = Date.now();
    socket.send('ping');
    notifyRecovery(entry, 'STREAM_RECOVERY');
    entry.heartbeatTimer = setInterval(() => {
      if (entry.socket === socket && socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, HEARTBEAT_INTERVAL_MS);
    entry.healthTimer = setInterval(() => {
      if (entry.socket !== socket) return;
      if (Date.now() - entry.lastMessageAt <= HEARTBEAT_STALE_MS) return;
      entry.needsRecovery = true;
      notifyHealth(entry, 'degraded');
      socket.close(4000, 'Heartbeat stale');
    }, HEALTH_CHECK_MS);
  };
  socket.onmessage = (message) => {
    if (entry.socket !== socket || typeof message.data !== 'string') return;
    if (message.data === 'pong') {
      markHealthy(entry);
      return;
    }
    try {
      const parsed = JSON.parse(message.data) as unknown;
      if (
        parsed && typeof parsed === 'object' &&
        (parsed as { type?: unknown }).type === 'canonical_stream_ready'
      ) {
        markHealthy(entry);
        return;
      }
      if (!isCanonicalChangeEvent(parsed)) return;
      markHealthy(entry);
      acceptMessage(entry, parsed);
    } catch { /* Ignore malformed transport frames. */ }
  };
  socket.onclose = () => {
    if (entry.socket !== socket || entry.disposed) return;
    entry.socket = null;
    clearTransportTimers(entry);
    entry.needsRecovery = true;
    notifyHealth(entry, 'degraded');
    scheduleReconnect(entry);
  };
  socket.onerror = () => {
    if (entry.socket === socket) socket.close();
  };
}

function createEntry(eventId: string): RegistryEntry {
  const entry: RegistryEntry = {
    eventId,
    consumers: new Map(),
    socket: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    healthTimer: null,
    releaseTimer: null,
    appStateSubscription: { remove: () => undefined },
    onlineSubscription: () => undefined,
    wasOnline: onlineManager.isOnline(),
    health: 'degraded',
    lastMessageAt: 0,
    latestRevision: 0,
    latestManifestVersion: null,
    attempts: 0,
    cooldownUntil: 0,
    probingAfterCooldown: false,
    needsRecovery: false,
    disposed: false,
  };
  entry.appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      notifyRecovery(entry, 'FOREGROUND_RECOVERY');
      connect(entry);
      return;
    }
    entry.needsRecovery = true;
    notifyHealth(entry, 'degraded');
    detachSocket(entry, 1000, 'App backgrounded');
  });
  entry.onlineSubscription = onlineManager.subscribe((online) => {
    const recovered = online && !entry.wasOnline;
    entry.wasOnline = online;
    if (!online) {
      entry.needsRecovery = true;
      notifyHealth(entry, 'degraded');
      detachSocket(entry, 1000, 'Network offline');
      return;
    }
    if (recovered) {
      notifyRecovery(entry, 'NETWORK_RECOVERY');
      connect(entry);
    }
  });
  return entry;
}

function dispose(entry: RegistryEntry) {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.appStateSubscription.remove();
  entry.onlineSubscription();
  detachSocket(entry, 1000, 'Final subscriber released');
  entries.delete(entry.eventId);
}

export function subscribeCanonicalChangeStream(input: {
  eventId: string;
  consumerId: string;
  onChange: Consumer['onChange'];
  onHealth: Consumer['onHealth'];
  onRecovery: Consumer['onRecovery'];
}): CanonicalChangeStreamLease {
  let entry = entries.get(input.eventId);
  if (!entry) {
    entry = createEntry(input.eventId);
    entries.set(input.eventId, entry);
  }
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = null;
  entry.consumers.set(input.consumerId, {
    id: input.consumerId,
    onChange: input.onChange,
    onHealth: input.onHealth,
    onRecovery: input.onRecovery,
  });
  input.onHealth(entry.health);
  connect(entry);
  let released = false;
  return {
    release() {
      if (released || !entry) return;
      released = true;
      entry.consumers.delete(input.consumerId);
      if (entry.consumers.size > 0) return;
      entry.releaseTimer = setTimeout(() => {
        if (entry && entry.consumers.size === 0) dispose(entry);
      }, RELEASE_GRACE_MS);
    },
  };
}

export function canonicalChangeStreamRegistrySnapshot() {
  return Array.from(entries.values()).map((entry) => ({
    eventId: entry.eventId,
    refCount: entry.consumers.size,
    health: entry.health,
    hasSocket: Boolean(entry.socket),
    latestRevision: entry.latestRevision,
  }));
}
