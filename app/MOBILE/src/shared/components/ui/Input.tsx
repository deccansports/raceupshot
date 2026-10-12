import { forwardRef, useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/core/theme';

import { Text } from './Text';

export type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  /** Optional element rendered inside the field (leading). */
  leading?: React.ReactNode;
  /** Optional element rendered inside the field (trailing). */
  trailing?: React.ReactNode;
  dense?: boolean;
};

/**
 * Themed text field with label and error state. Works standalone or wired to
 * React Hook Form via value/onChangeText.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, leading, trailing, dense = false, style, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.accent
      : theme.colors.border;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {label ? (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: dense ? 40 : 48,
          paddingHorizontal: dense ? theme.spacing.sm : theme.spacing.md,
          borderWidth: 1,
          borderColor,
          borderRadius: theme.radius.medium,
          backgroundColor: theme.colors.surface,
        }}>
        {leading}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            { flex: 1, color: theme.colors.textPrimary, fontSize: dense ? 15 : 16, paddingVertical: dense ? 6 : 10 },
            style,
          ]}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="bodySmall" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
});
