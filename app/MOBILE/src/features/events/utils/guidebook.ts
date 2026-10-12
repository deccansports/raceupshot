export type GuidebookResolution = {
  originalUrl: string;
  viewerUrl: string;
  nativePdfUrl: string;
};

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = guidebookValue(value);
    if (candidate) return candidate;
  }
  return '';
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function guidebookValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const record = nestedRecord(value);
  if (!record) return '';
  return [record.url, record.uri, record.href, record.downloadUrl, record.pdfUrl, record.fileUrl]
    .map((candidate) => typeof candidate === 'string' ? candidate.trim() : '')
    .find(Boolean) ?? '';
}

const GUIDEBOOK_KEYS = /(?:athlete)?guide(?:book)?|handbook|raceguide|pdf|download/i;

function findNestedGuidebookUrl(value: unknown, depth = 0): string {
  if (depth > 4) return '';
  const record = nestedRecord(value);
  if (!record) return '';
  for (const [key, candidate] of Object.entries(record)) {
    if (!GUIDEBOOK_KEYS.test(key)) continue;
    const url = guidebookValue(candidate);
    if (url) return url;
  }
  for (const candidate of Object.values(record)) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const url = findNestedGuidebookUrl(item, depth + 1);
        if (url) return url;
      }
      continue;
    }
    const url = findNestedGuidebookUrl(candidate, depth + 1);
    if (url) return url;
  }
  return '';
}

export function resolveGuidebookUrl(event: unknown): string {
  const record = nestedRecord(event);
  if (!record) return '';

  const courseDetails = nestedRecord(record.courseDetails);
  const media = nestedRecord(record.media) ?? nestedRecord(courseDetails?.media);
  const raw = nestedRecord(record.raw);
  const rawCourseDetails = nestedRecord(raw?.courseDetails);
  const rawMedia = nestedRecord(rawCourseDetails?.media);

  return firstText(
    record.athleteGuidebookUrl,
    record.athleteGuidebook,
    record.athleteGuideBook,
    record.athleteGuideUrl,
    record.guidebookUrl,
    record.guideUrl,
    record.pdfUrl,
    record.downloadUrl,
    record.athleteGuideBookUrl,
    record.guideBookUrl,
    courseDetails?.athleteGuidebookUrl,
    courseDetails?.athleteGuidebook,
    courseDetails?.athleteGuideBook,
    courseDetails?.athleteGuideUrl,
    courseDetails?.guidebookUrl,
    courseDetails?.guideUrl,
    courseDetails?.pdfUrl,
    courseDetails?.downloadUrl,
    courseDetails?.athleteGuideBookUrl,
    courseDetails?.guideBookUrl,
    media?.guidebookUrl,
    media?.guideUrl,
    media?.pdfUrl,
    media?.downloadUrl,
    raw?.athleteGuidebookUrl,
    raw?.athleteGuidebook,
    raw?.athleteGuideBook,
    raw?.athleteGuideUrl,
    raw?.guidebookUrl,
    raw?.guideUrl,
    raw?.pdfUrl,
    raw?.downloadUrl,
    raw?.athleteGuideBookUrl,
    raw?.guideBookUrl,
    rawCourseDetails?.athleteGuidebookUrl,
    rawCourseDetails?.athleteGuideUrl,
    rawCourseDetails?.guidebookUrl,
    rawCourseDetails?.guideUrl,
    rawCourseDetails?.pdfUrl,
    rawCourseDetails?.downloadUrl,
    rawMedia?.guidebookUrl,
    rawMedia?.guideUrl,
    rawMedia?.pdfUrl,
    rawMedia?.downloadUrl,
    findNestedGuidebookUrl(record),
  );
}

export function normalizeGuidebookUrl(url: string): string {
  const trimmed = url.trim();
  const driveFileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (driveFileMatch?.[1]) {
    return `https://drive.google.com/file/d/${driveFileMatch[1]}/preview`;
  }

  const driveOpenMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([^&#]+)/i);
  if (driveOpenMatch?.[1]) {
    return `https://drive.google.com/file/d/${driveOpenMatch[1]}/preview`;
  }

  return trimmed;
}

export function normalizeNativePdfUrl(url: string): string {
  const trimmed = url.trim();
  const driveFileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (driveFileMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${driveFileMatch[1]}`;
  }

  const driveOpenMatch = trimmed.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([^&#]+)/i);
  if (driveOpenMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${driveOpenMatch[1]}`;
  }

  return trimmed;
}

export function isDirectPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return decodeURIComponent(parsed.pathname).toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

export function getPdfViewerFallbackUrl(url: string): string {
  return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url.trim())}`;
}

export function isValidGuidebookUrl(url: string): boolean {
  const candidate = url.trim();
  if (!candidate) return false;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return false;

    const host = parsed.hostname.toLowerCase();
    const path = decodeURIComponent(parsed.pathname).toLowerCase();
    const isKnownHost =
      host === 'drive.google.com' ||
      host === 'firebasestorage.googleapis.com' ||
      host === 'bergmantri.com' ||
      host.endsWith('.bergmantri.com');

    return isKnownHost || path.endsWith('.pdf');
  } catch {
    return false;
  }
}

export function resolveValidGuidebook(event: unknown): GuidebookResolution | null {
  const originalUrl = resolveGuidebookUrl(event);
  if (!isValidGuidebookUrl(originalUrl)) return null;
  return {
    originalUrl,
    viewerUrl: normalizeGuidebookUrl(originalUrl),
    nativePdfUrl: normalizeNativePdfUrl(originalUrl),
  };
}
