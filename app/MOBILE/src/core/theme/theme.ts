import { breakpoints, maxContentWidth, type Breakpoints } from './breakpoints';
import { darkColors, lightColors, type SemanticColors } from './colors';
import { motion, type Motion } from './motion';
import { radius, type Radius } from './radius';
import { shadows, type ElevationVariant } from './shadows';
import { spacing, type Spacing } from './spacing';
import { typography, type TypographyVariant } from './typography';

import type { TextStyle, ViewStyle } from 'react-native';

export type ColorSchemeName = 'light' | 'dark';

export type Theme = {
  scheme: ColorSchemeName;
  colors: SemanticColors;
  spacing: Spacing;
  radius: Radius;
  typography: Record<TypographyVariant, TextStyle>;
  shadows: Record<ElevationVariant, ViewStyle>;
  motion: Motion;
  breakpoints: Breakpoints;
  maxContentWidth: number;
};

const shared = {
  spacing,
  radius,
  typography,
  shadows,
  motion,
  breakpoints,
  maxContentWidth,
};

export const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  ...shared,
};

export const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  ...shared,
};

export const themes: Record<ColorSchemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};
