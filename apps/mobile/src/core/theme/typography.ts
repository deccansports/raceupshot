import type { TextStyle } from 'react-native';

/**
 * BERGMAN typography scale.
 *
 * Principles: bold, confident headings; large tabular numbers for metrics and
 * timing so results are readable at a glance and split tables align cleanly.
 */
export type TypographyVariant =
  | 'displayLarge'
  | 'display'
  | 'heroTitle'
  | 'title'
  | 'headline'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'caption'
  | 'metric'
  | 'metricSmall'
  | 'monoMetric';

export const typography: Record<TypographyVariant, TextStyle> = {
  displayLarge: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -0.6 },
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.5 },
  heroTitle: { fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -0.4 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.2 },
  // Large bold number for counts and stats (e.g. "1,284").
  metric: { fontSize: 30, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricSmall: { fontSize: 20, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Monospaced-feel timing for split tables (e.g. "1:23:45").
  monoMetric: { fontSize: 16, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
};
