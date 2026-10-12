import { Platform, Pressable, TextInput, View, type ViewStyle } from 'react-native';
import type { ComponentProps } from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useTheme } from '@/core/theme';

export type SearchBarProps = Omit<ComponentProps<typeof TextInput>, 'placeholder' | 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
  dense?: boolean;
};

const searchShadow: ViewStyle = Platform.OS === 'web'
  ? ({ boxShadow: '0 6px 16px rgba(11, 94, 215, 0.08)' } as ViewStyle)
  : {
      shadowColor: '#0B5ED7',
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    };

function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function ClearIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Lightweight, compact search field with a sporty accent treatment. */
export function SearchBar({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search',
  dense = false,
  style,
  ...rest
}: SearchBarProps) {
  const theme = useTheme();
  const height = dense ? 42 : 48;

  return (
    <View
      style={{
        borderRadius: 999,
        padding: 1,
        backgroundColor: 'rgba(46, 116, 214, 0.14)',
        borderWidth: 1,
        borderColor: 'rgba(46, 116, 214, 0.18)',
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: height,
          paddingHorizontal: 12,
          borderRadius: 999,
          backgroundColor: theme.colors.surfaceElevated,
          ...searchShadow,
        }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(46, 116, 214, 0.12)',
          }}>
          <SearchIcon color={theme.colors.accent} />
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          style={[
            {
              flex: 1,
              color: theme.colors.textPrimary,
              fontSize: dense ? 15 : 16,
              paddingVertical: 0,
            },
            style,
          ]}
          {...rest}
        />
        {value.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            onPress={() => {
              onChangeText('');
              onClear?.();
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.06)',
            }}>
            <ClearIcon color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
