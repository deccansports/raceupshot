export type AthleteBibLabelMetrics = {
  label: string;
  width: number;
  fontSize: number;
};

export function athleteBibLabelMetrics(value: unknown): AthleteBibLabelMetrics {
  const label = String(value ?? '').trim();
  const length = Math.max(1, label.length);
  return {
    label,
    width: Math.min(96, Math.max(34, 14 + length * 7)),
    fontSize: length <= 4 ? 10 : length <= 6 ? 9 : length <= 9 ? 8 : 7,
  };
}
