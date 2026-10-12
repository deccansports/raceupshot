import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/core/theme';

import { Text } from './Text';

export type LogoProps = {
  size?: number;
  showWordmark?: boolean;
};

/**
 * BERGMAN vector logo: an upward peak/motion mark in brand red, optionally
 * paired with the wordmark. Theme-aware and crisp at any size.
 */
export function Logo({ size = 40, showWordmark = false }: LogoProps) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: theme.colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
          <Path
            d="M3 19 L12 5 L21 19"
            stroke={theme.colors.onAccent}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M7.5 19 L12 11.5 L16.5 19"
            stroke={theme.colors.onAccent}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
          />
        </Svg>
      </View>
      {showWordmark ? (
        <Text variant="title" style={{ letterSpacing: 1 }}>
          BERGMAN
        </Text>
      ) : null}
    </View>
  );
}
