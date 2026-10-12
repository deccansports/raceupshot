export interface StoredCertificateElement {
  id: string;
  variable: string;
  label: string;
  sample: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  weight: "400" | "700";
}

export interface StoredCertificateTemplate {
  eventSlug: string;
  category: string;
  artworkName?: string;
  artworkType?: string;
  artworkData?: string;
  elements: StoredCertificateElement[];
  savedAt: string;
}

export function certificateTemplateId(eventSlug: string, category: string) {
  return `${eventSlug}:${category.toLowerCase()}`;
}
