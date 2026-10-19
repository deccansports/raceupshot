import { authenticatedJson } from '@/core/auth/authenticatedFetch';

/**
 * Certificates repository.
 *
 * The mobile app reads athlete certificate summaries from the Mobile API
 * Worker. The endpoint is authenticated and returns a list payload.
 */
export type CertificateSummary = {
  id: string;
  eventTitle: string;
  dateLabel: string;
  downloadUrl?: string;
};

export interface ICertificatesRepository {
  getMyCertificates(): Promise<CertificateSummary[]>;
}

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCertificate(raw: Partial<CertificateSummary> & Record<string, unknown>, index: number): CertificateSummary {
  return {
    id: toText(raw.id ?? raw.certificateId ?? raw.certificate_id) || `certificate-${index}`,
    eventTitle: toText(raw.eventTitle ?? raw.eventName ?? raw.title ?? raw.event) || 'Certificate',
    dateLabel: toText(raw.dateLabel ?? raw.date ?? raw.createdAt ?? raw.issuedAt) || '—',
    downloadUrl: toText(raw.downloadUrl ?? raw.url) || undefined,
  };
}

export const ProductionCertificatesRepository: ICertificatesRepository = {
  async getMyCertificates() {
    try {
      const res = await authenticatedJson<unknown>('/api/certificates');
      const items =
        Array.isArray(res)
          ? res
          : Array.isArray((res as { certificates?: unknown[] }).certificates)
            ? (res as { certificates: unknown[] }).certificates
            : Array.isArray((res as { items?: unknown[] }).items)
              ? (res as { items: unknown[] }).items
              : Array.isArray((res as { data?: unknown[] }).data)
                ? (res as { data: unknown[] }).data
                : [];
      return items.map((item, index) => normalizeCertificate(item as Record<string, unknown>, index));
    } catch (error) {
      if ((error as { status?: number }).status === 404) return [];
      throw error;
    }
  },
};
