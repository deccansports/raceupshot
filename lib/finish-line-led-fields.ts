export const LED_FIELD_IDS = ["bib", "name", "flag", "country", "gender", "ageGroup", "category", "finishTime", "status"] as const;
export type LedField = typeof LED_FIELD_IDS[number];
export const LED_FIELD_LABELS: Record<LedField, string> = {
  bib: "Bib", name: "Athlete", flag: "Flag", country: "Country", gender: "Gender",
  ageGroup: "Age group", category: "Contest", finishTime: "Chip time", status: "Status",
};
export const DEFAULT_LED_FIELDS: LedField[] = ["bib", "name", "flag", "ageGroup", "finishTime", "status"];

export function normalizeLedFields(value: unknown): LedField[] {
  const fields = Array.isArray(value) ? [...new Set(value)].filter((field): field is LedField => LED_FIELD_IDS.includes(field as LedField)) : [];
  return fields.length ? fields : [...DEFAULT_LED_FIELDS];
}

export function ledGridColumns(fields: LedField[]): string {
  return fields.map((field) => `minmax(0, ${field === "name" ? 2.4 : field === "flag" ? 0.45 : field === "finishTime" ? 1.4 : 1}fr)`).join(" ");
}

export function moveLedField(fields: LedField[], field: LedField, target: LedField): LedField[] {
  const from = fields.indexOf(field);
  const to = fields.indexOf(target);
  if (from < 0 || to < 0 || from === to) return fields;
  const reordered = [...fields];
  reordered.splice(from, 1);
  reordered.splice(to, 0, field);
  return reordered;
}
