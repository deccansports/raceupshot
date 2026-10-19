/** Corner radius tokens. BERGMAN cards favor large, soft rounding. */
export const radius = {
  small: 8,
  medium: 12,
  large: 20,
  xl: 28,
  full: 9999,
} as const;

export type Radius = typeof radius;
