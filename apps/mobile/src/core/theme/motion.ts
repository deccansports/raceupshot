/** Motion tokens. Animations should be short and interruptible. */
export const motion = {
  duration: {
    fast: 120,
    base: 200,
    slow: 320,
  },
  /** Default spring for interactive elements (press, sheets). */
  spring: {
    damping: 18,
    stiffness: 220,
    mass: 1,
  },
  /** Scale applied on press for tactile feedback. */
  pressScale: 0.97,
} as const;

export type Motion = typeof motion;
