import { useWindowDimensions } from 'react-native';

import { breakpoints, tabletMinWidth, type BreakpointName } from '@/core/theme';

export type Responsive = {
  width: number;
  height: number;
  isTablet: boolean;
  isLandscape: boolean;
  breakpoint: BreakpointName;
};

/** Derives responsive layout info from the current window dimensions. */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const breakpoint: BreakpointName =
    width >= breakpoints.xl
      ? 'xl'
      : width >= breakpoints.lg
        ? 'lg'
        : width >= breakpoints.md
          ? 'md'
          : 'sm';

  return {
    width,
    height,
    isTablet: width >= tabletMinWidth,
    isLandscape: width > height,
    breakpoint,
  };
}
