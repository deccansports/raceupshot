import { eventDocumentSrcDoc } from "./event-document";

export interface WaiverTemplateParameter {
  label: string;
  token: string;
}

export interface WaiverTemplateParameterGroup {
  label: string;
  parameters: WaiverTemplateParameter[];
}

export const waiverTemplateParameterGroups: WaiverTemplateParameterGroup[] = [
  {
    label: "Athlete",
    parameters: [
      { label: "Athlete name", token: "{{params.name}}" },
      { label: "Email address", token: "{{params.email}}" },
      { label: "Mobile number", token: "{{params.mobile}}" },
      { label: "Address", token: "{{params.address}}" },
      { label: "Emergency contact", token: "{{params.emergency_contact}}" },
    ],
  },
  {
    label: "Event",
    parameters: [
      { label: "Event name", token: "{{params.event_name}}" },
      { label: "Race category", token: "{{params.race_category}}" },
      { label: "Event date", token: "{{params.event_date}}" },
      { label: "Bib number", token: "{{params.bib_number}}" },
    ],
  },
  {
    label: "Relay team",
    parameters: [
      { label: "Team name", token: "{{params.team_name}}" },
      { label: "Team bib", token: "{{params.team_bib}}" },
      { label: "Registered team members", token: "{{params.team_members}}" },
    ],
  },
  {
    label: "Digital signing",
    parameters: [
      { label: "Signed timestamp", token: "{{params.signed_at}}" },
      { label: "Waiver ID", token: "{{params.waiver_id}}" },
      { label: "Waiver version", token: "{{params.waiver_version}}" },
      { label: "Signature name", token: "{{params.signature_name}}" },
    ],
  },
  {
    label: "Organiser",
    parameters: [
      { label: "Organiser name", token: "{{organizer_name}}" },
      { label: "Company description", token: "{{company_description}}" },
      { label: "Organiser address", token: "{{organizer_address}}" },
      { label: "Country", token: "{{country}}" },
      { label: "Legal jurisdiction", token: "{{jurisdiction}}" },
    ],
  },
  {
    label: "Agreement date",
    parameters: [
      { label: "Day", token: "{{day}}" },
      { label: "Date", token: "{{date}}" },
    ],
  },
];

export interface WaiverTemplateValues {
  name?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  address?: string;
  emergency_contact?: string;
  emergency_number?: string;
  event_name?: string;
  eventname?: string;
  race_category?: string;
  category?: string;
  event_date?: string;
  eventdate?: string;
  bib_number?: string;
  signed_at?: string;
  waiver_id?: string;
  waiver_version?: string;
  signature_name?: string;
  day?: string;
  date?: string;
  organizer_name?: string;
  organiser_name?: string;
  company_description?: string;
  organizer_address?: string;
  organiser_address?: string;
  country?: string;
  jurisdiction?: string;
  team_name?: string;
  team_bib?: string;
  team_members?: string;
}

export type WaiverParameterSource = keyof WaiverTemplateValues | "custom";
export interface WaiverParameterMapping {
  token: string;
  source: string;
  customValue?: string;
}

export const waiverParameterSources: Array<{ value: WaiverParameterSource; label: string }> = [
  ...["name", "email", "mobile", "phone", "address", "emergency_contact", "emergency_number", "event_name", "race_category", "event_date", "bib_number", "signed_at", "waiver_id", "waiver_version", "signature_name", "day", "date", "organizer_name", "company_description", "organizer_address", "country", "jurisdiction", "team_name", "team_bib", "team_members"].map((value) => ({ value: value as WaiverParameterSource, label: value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) })),
  { value: "custom", label: "Custom value for this event" },
];

const waiverParameterSourceAliases: Record<string, WaiverParameterSource> = {
  eventname: "event_name",
  category: "race_category",
  eventdate: "event_date",
  organiser_name: "organizer_name",
  organiser_address: "organizer_address",
};

export function waiverTemplateMappingTokens(template: string): string[] {
  return [...new Set([
    ...waiverTemplateTokens(template),
    ...waiverParameterSources.filter((source) => source.value !== "custom").map((source) => source.value),
  ])];
}

export function inferredWaiverParameterSource(token: string): WaiverParameterSource {
  const normalized = normalizedToken(token);
  if (waiverParameterSources.some((source) => source.value === normalized)) return normalized as WaiverParameterSource;
  return waiverParameterSourceAliases[normalized] ?? "custom";
}

export function waiverTemplateTokens(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)]
    .map((match) => match[1].replace(/^params\./i, "").toLowerCase()))];
}

function normalizedToken(token: string): string {
  return token.trim().replace(/^params\./i, "").toLowerCase();
}

const waiverParameterAliases: Record<string, keyof WaiverTemplateValues> = {
  name: "name",
  email: "email",
  mobile: "mobile",
  phone: "phone",
  address: "address",
  emergency_contact: "emergency_contact",
  emergency_number: "emergency_number",
  event_name: "event_name",
  eventname: "eventname",
  race_category: "race_category",
  category: "category",
  event_date: "event_date",
  eventdate: "eventdate",
  bib_number: "bib_number",
  signed_at: "signed_at",
  waiver_id: "waiver_id",
  waiver_version: "waiver_version",
  signature_name: "signature_name",
  day: "day",
  date: "date",
  organizer_name: "organizer_name",
  organiser_name: "organiser_name",
  company_description: "company_description",
  organizer_address: "organizer_address",
  organiser_address: "organiser_address",
  country: "country",
  jurisdiction: "jurisdiction",
  team_name: "team_name",
  team_bib: "team_bib",
  team_members: "team_members",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

function valueForParameter(key: string, values: WaiverTemplateValues): string | undefined {
  const normalized = key.trim().replace(/^params\./i, "").toLowerCase();
  const direct = waiverParameterAliases[normalized];
  const value = direct ? values[direct] : undefined;
  if (value) return value;
  const fallbacks: Record<string, Array<keyof WaiverTemplateValues>> = {
    mobile: ["phone"], phone: ["mobile"],
    emergency_contact: ["emergency_number"], emergency_number: ["emergency_contact"],
    event_name: ["eventname"], eventname: ["event_name"],
    race_category: ["category"], category: ["race_category"],
    event_date: ["eventdate", "date"], eventdate: ["event_date", "date"],
    signature_name: ["name"],
    organizer_name: ["organiser_name"], organiser_name: ["organizer_name"],
    organizer_address: ["organiser_address"], organiser_address: ["organizer_address"],
  };
  return fallbacks[normalized]?.map((candidate) => values[candidate]).find(Boolean);
}

export function renderWaiverTemplate(template: string, values: WaiverTemplateValues, mappings: WaiverParameterMapping[] = []): string {
  const mappingByToken = new Map(mappings.map((mapping) => [normalizedToken(mapping.token), mapping]));
  return template.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (token, key: string) => {
    const mapping = mappingByToken.get(normalizedToken(key));
    const value = mapping?.source === "custom" ? mapping.customValue : mapping ? valueForParameter(mapping.source, values) : valueForParameter(key, values);
    return value === undefined ? token : escapeHtml(value);
  });
}

const waiverPreviewStyles = `<style>
  body{white-space:pre-wrap}
  .waiver-document{white-space:pre-wrap;font:14px/1.65 Inter,Arial,sans-serif;color:#172033}
  .waiver-document strong{font-weight:800;color:#0f172a}
  .waiver-document table{white-space:normal}
</style>`;

export function waiverTemplateSrcDoc(template: string, values: WaiverTemplateValues = {}, mappings: WaiverParameterMapping[] = []): string {
  const rendered = renderWaiverTemplate(template, values, mappings);
  if (/<html[\s>]/i.test(rendered)) {
    const styled = /<\/head\s*>/i.test(rendered)
      ? rendered.replace(/<\/head\s*>/i, `${waiverPreviewStyles}</head>`)
      : `${waiverPreviewStyles}${rendered}`;
    return eventDocumentSrcDoc(styled);
  }
  return eventDocumentSrcDoc(`${waiverPreviewStyles}<div class="waiver-document">${rendered}</div>`);
}

export function appendWaiverTemplateParameter(template: string, token: string): string {
  const current = template.trimEnd();
  const insertion = `<strong>${token}</strong>`;
  return current ? `${current}\n${insertion}` : insertion;
}
