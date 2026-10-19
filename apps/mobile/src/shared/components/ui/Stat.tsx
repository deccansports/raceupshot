import { View } from 'react-native';

import { type SemanticColors } from '@/core/theme';

import { Text } from './Text';

export type StatProps = {
  value: string;
  label: string;
  align?: 'left' | 'center';
  size?: 'md' | 'lg';
  color?: keyof SemanticColors;
  labelColor?: keyof SemanticColors;
};

/** Bold metric display: large tabular number over a small uppercase label. */
export function Stat({
  value,
  label,
  align = 'left',
  size = 'md',
  color = 'textPrimary',
  labelColor = 'textMuted',
}: StatProps) {
  return (
    <View style={{ alignItems: align === 'center' ? 'center' : 'flex-start', gap: 2 }}>
      <Text variant={size === 'lg' ? 'metric' : 'metricSmall'} color={color}>
        {value}
      </Text>
      <Text variant="caption" color={labelColor}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
