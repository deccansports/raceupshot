import {
	documentDirectory,
	getInfoAsync,
	makeDirectoryAsync,
	readAsStringAsync,
	writeAsStringAsync,
} from 'expo-file-system/legacy';

import type { LiveEventDto } from '@/core/types';

export type EventContentCacheEntry = {
	event?: LiveEventDto | null;
	rulesHtml?: string | null;
	updatedAt: string;
};

const CACHE_DIR = `${documentDirectory ?? ''}event-content-cache/v1`;

function cacheFileUri(eventId: string): string {
	return `${CACHE_DIR}/${encodeURIComponent(eventId)}.json`;
}

async function ensureCacheDirectory(): Promise<void> {
	if (!documentDirectory) return;
	const info = await getInfoAsync(CACHE_DIR);
	if (!info.exists) {
		await makeDirectoryAsync(CACHE_DIR, { intermediates: true });
	}
}

export async function readEventContentCache(eventId: string): Promise<EventContentCacheEntry | null> {
	if (!documentDirectory) return null;
	try {
		const info = await getInfoAsync(cacheFileUri(eventId));
		if (!info.exists) return null;
		const raw = await readAsStringAsync(cacheFileUri(eventId));
		const parsed = JSON.parse(raw) as EventContentCacheEntry;
		if (!parsed || typeof parsed !== 'object') return null;
		return {
			event: parsed.event ?? null,
			rulesHtml: parsed.rulesHtml ?? null,
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
		};
	} catch {
		return null;
	}
}

export async function writeEventContentCache(eventId: string, patch: Partial<EventContentCacheEntry>): Promise<void> {
	if (!documentDirectory) return;
	try {
		await ensureCacheDirectory();
		const existing = await readEventContentCache(eventId);
		const entry: EventContentCacheEntry = {
			event: patch.event !== undefined ? patch.event : existing?.event ?? null,
			rulesHtml: patch.rulesHtml !== undefined ? patch.rulesHtml : existing?.rulesHtml ?? null,
			updatedAt: new Date().toISOString(),
		};
		await writeAsStringAsync(cacheFileUri(eventId), JSON.stringify(entry));
	} catch {
		// Cache failures must never break the event experience.
	}
}

export async function readCachedEvent(eventId: string): Promise<LiveEventDto | null> {
	const entry = await readEventContentCache(eventId);
	return entry?.event ?? null;
}

export async function readCachedRulesHtml(eventId: string): Promise<string | null> {
	const entry = await readEventContentCache(eventId);
	return entry?.rulesHtml ?? null;
}
