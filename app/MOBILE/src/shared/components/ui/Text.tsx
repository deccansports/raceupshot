import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme, type SemanticColors, type TypographyVariant } from '@/core/theme';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: keyof SemanticColors;
  center?: boolean;
};

/**
 * Themed text primitive. Centralizes typography variants and semantic colors,
 * and inherits dynamic type scaling from the platform.
 */
export function Text({
  variant = 'body',
  color = 'textPrimary',
  center,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      style={[
        theme.typography[variant],
        { color: theme.colors[color] },
        center && { textAlign: 'center' },
        style,
      ]}
      {...rest}
    />
  );
}
