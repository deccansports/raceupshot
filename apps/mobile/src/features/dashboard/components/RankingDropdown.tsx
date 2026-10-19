import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Badge, Card, Icon, Modal, Text } from '@/shared/components';

export type RankingDropdownOption = {
  key: string;
  label: string;
  helper?: string;
};

type RankingDropdownProps = {
  label: string;
  value: string;
  options: RankingDropdownOption[];
  onChange: (key: string) => void;
  subtitle?: string;
};

export function RankingDropdown({ label, value, options, onChange, subtitle }: RankingDropdownProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((option) => option.key === value) ?? options[0], [options, value]);

  return (
    <>
      <Card onPress={() => setOpen(true)} style={{ gap: theme.spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="label" color="textMuted">
              {label}
            </Text>
            <Text variant="headline">{selected?.label ?? value}</Text>
            {subtitle ? (
              <Text variant="bodySmall" color="textMuted">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Badge label="Dropdown" variant="neutral" />
          <Icon name="chevronDown" color="textMuted" />
        </View>
      </Card>

      <Modal visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ gap: theme.spacing.sm }}>
          {options.map((option) => {
            const active = option.key === value;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
                style={{
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.base,
                  borderRadius: theme.radius.medium,
                  backgroundColor: active ? `${theme.colors.accent}1F` : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                  gap: 4,
                }}>
                <Text variant="headline" style={{ color: active ? theme.colors.accent : theme.colors.textPrimary }}>
                  {option.label}
                </Text>
                {option.helper ? (
                  <Text variant="bodySmall" color="textMuted">
                    {option.helper}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}