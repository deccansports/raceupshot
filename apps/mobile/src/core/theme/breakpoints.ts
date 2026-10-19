/** Responsive breakpoints (min width in points). */
export const breakpoints = {
  sm: 360,
  md: 600,
  lg: 840,
  xl: 1024,
} as const;

/** Width at or above which layouts should adopt tablet behavior. */
export const tabletMinWidth = breakpoints.md;

/** Max content width for reading surfaces on large screens. */
export const maxContentWidth = 720;

export type BreakpointName = keyof typeof breakpoints;
export type Breakpoints = typeof breakpoints;
