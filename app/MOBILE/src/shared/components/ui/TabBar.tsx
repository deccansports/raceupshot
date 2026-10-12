import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Text } from './Text';

export type TabItem = {
  key: string;
  label: string;
};

export type TabBarProps = {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
};

/** Segmented in-screen tab control (e.g. leaderboard categories). */
export function TabBar({ items, activeKey, onChange }: TabBarProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.medium,
          borderColor: theme.colors.border,
        },
      ]}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => onChange(item.key)}
            style={[
              styles.tab,
              {
                backgroundColor: active ? theme.colors.accent : 'transparent',
                borderRadius: theme.radius.small,
              },
            ]}>
            <Text
              variant="label"
              style={{ color: active ? theme.colors.onAccent : theme.colors.textSecondary }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', padding: 4, gap: 4, borderWidth: 1 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    minHeight: 40,
  },
});
