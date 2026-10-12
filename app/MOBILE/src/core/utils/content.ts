function toText(value: unknown): string | undefined {
	const text = String(value ?? '').trim();
	return text ? text : undefined;
}

function firstText(...values: unknown[]): string | undefined {
	for (const value of values) {
		const text = toText(value);
		if (text) return text;
	}
	return undefined;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Normalizes CMS / Firestore content into HTML that can be rendered safely.
 * Plain text is escaped and line breaks are preserved.
 */
export function normalizeHtmlContent(value: unknown): string | undefined {
	const text = toText(value);
	if (!text) return undefined;
	if (/<[a-z][\s\S]*>/i.test(text)) return text;
	return `<div>${escapeHtml(text).replace(/\r?\n/g, '<br />')}</div>`;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function formatCutoffMinutes(value: unknown): string | undefined {
	const numeric = toFiniteNumber(value);
	if (numeric == null) return undefined;
	if (numeric >= 60 && numeric % 60 === 0) {
		return `${numeric / 60}h`;
	}
	if (numeric >= 60) {
		const hours = Math.floor(numeric / 60);
		const minutes = numeric % 60;
		return `${hours}h ${minutes}m`;
	}
	return `${numeric} min`;
}

/**
 * Builds a short cutoff summary for race details and course-map panels.
 */
export function formatCutoffSummary(
	cutoffMinutes: number | null | undefined,
	cutoffs: Record<string, unknown> | unknown[] | null | undefined,
): string[] {
	const lines: string[] = [];
	const overall = formatCutoffMinutes(cutoffMinutes);
	if (overall) lines.push(`Overall cutoff: ${overall}`);

	if (Array.isArray(cutoffs)) {
		for (const entry of cutoffs.slice(0, 3)) {
			if (typeof entry === 'string' && entry.trim()) {
				lines.push(entry.trim());
				continue;
			}
			if (entry && typeof entry === 'object') {
				const record = entry as Record<string, unknown>;
				const label = firstText(record.label, record.name, record.title, record.split);
				const value = firstText(
					record.cutoffMinutes,
					record.minutes,
					record.time,
					record.distance,
					record.cutoff,
				);
				const line = [label, value ? `— ${value}` : undefined].filter(Boolean).join(' ');
				if (line) lines.push(line);
			}
		}
	} else if (cutoffs && typeof cutoffs === 'object') {
		const record = cutoffs as Record<string, unknown>;
		for (const [key, value] of Object.entries(record).slice(0, 3)) {
			if (value == null) continue;
			if (typeof value === 'string' || typeof value === 'number') {
				lines.push(`${key}: ${value}`);
				continue;
			}
			if (value && typeof value === 'object') {
				const nested = value as Record<string, unknown>;
				const label = firstText(nested.label, nested.name, nested.title) ?? key;
				const minutes = formatCutoffMinutes(nested.cutoffMinutes ?? nested.minutes ?? nested.time);
				lines.push(minutes ? `${label}: ${minutes}` : label);
			}
		}
	}

	return lines;
}
