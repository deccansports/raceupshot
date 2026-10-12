/**
 * BERGMAN Race brand and semantic color tokens.
 *
 * The palette is built for a premium endurance-sports identity: a confident
 * BERGMAN Red primary, a deep BERGMAN Blue secondary, near-black surfaces, and
 * high-contrast race-status colors optimized for fast visual scanning.
 *
 * Every semantic color has a light and dark variant.
 */

export const brand = {
  red: '#E1122A',
  redBright: '#FF3341',
  redDark: '#A50D1F',
  blue: '#0B4EA2',
  blueBright: '#2E74D6',
  blueDark: '#062F63',
  ink: '#0B0D12',
  white: '#FFFFFF',
} as const;

export type SemanticColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSecondary: string;
  onAccent: string;
  /** Translucent overlay for edge-to-edge imagery to keep text legible. */
  scrim: string;
  // Semantic feedback
  success: string;
  warning: string;
  danger: string;
  // Race status (distinct, high-contrast, scannable)
  live: string;
  statusLive: string;
  statusFinished: string;
  statusUpcoming: string;
  statusNotStarted: string;
};

export const lightColors: SemanticColors = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#ECEEF2',
  textPrimary: '#0B0D12',
  textSecondary: '#3B4149',
  textMuted: '#6B7280',
  textInverse: '#FFFFFF',
  border: '#E3E6EB',
  borderStrong: '#CDD2DA',
  accent: brand.red,
  accentSecondary: brand.blue,
  onAccent: '#FFFFFF',
  scrim: 'rgba(11,13,18,0.55)',
  success: '#12805C',
  warning: '#B25E09',
  danger: '#C0271F',
  live: brand.red,
  statusLive: brand.red,
  statusFinished: '#12805C',
  statusUpcoming: '#C08A00',
  statusNotStarted: '#8A919C',
};

export const darkColors: SemanticColors = {
  background: '#0B0D12',
  surface: '#14171D',
  surfaceElevated: '#1B1F27',
  surfaceSunken: '#0E1116',
  textPrimary: '#F5F6F8',
  textSecondary: '#C3C8D0',
  textMuted: '#868D98',
  textInverse: '#0B0D12',
  border: '#282D37',
  borderStrong: '#3A414D',
  accent: brand.redBright,
  accentSecondary: brand.blueBright,
  onAccent: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.5)',
  success: '#3DD68C',
  warning: '#E0A64B',
  danger: '#FF6259',
  live: brand.redBright,
  statusLive: brand.redBright,
  statusFinished: '#3DD68C',
  statusUpcoming: '#E7B44E',
  statusNotStarted: '#868D98',
};
