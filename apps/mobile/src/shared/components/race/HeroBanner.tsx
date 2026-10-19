import { type ReactNode } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/core/theme';

import { FloatingActionButton } from '../ui/FloatingActionButton';
import { Icon, type IconName } from '../ui/Icon';
import { Stat } from '../ui/Stat';
import { Text } from '../ui/Text';
import { RaceStatusBadge } from './RaceStatusBadge';
import { type RaceStatus } from './RaceStatus';

export type HeroStat = { value: string; label: string };

export type HeroBannerProps = {
  title: string;
  /** Small line above the title (greeting, discipline, or section label). */
  eyebrow?: string;
  eyebrowIcon?: IconName;
  subtitle?: string;
  status?: RaceStatus;
  stats?: HeroStat[];
  actionLabel?: string;
  onAction?: () => void;
  imageUri?: string;
  height?: number;
  children?: ReactNode;
};

/**
 * BERGMAN Hero Banner — the signature section that opens every major screen.
 *
 * Supports two patterns:
 *  - Live/event hero: edge-to-edge image, status badge, big stats, floating CTA.
 *  - Greeting hero: solid brand background with eyebrow, title, and a stat.
 */
export function HeroBanner({
  title,
  eyebrow,
  eyebrowIcon,
  subtitle,
  status,
  stats,
  actionLabel,
  onAction,
  imageUri,
  height = 240,
  children,
}: HeroBannerProps) {
  const theme = useTheme();

  const content = (
    <View style={styles.content}>
      <View style={styles.topRow}>
        {eyebrow ? (
          <View style={styles.eyebrow}>
            {eyebrowIcon ? <Icon name={eyebrowIcon} size={16} color="textInverse" /> : null}
            <Text variant="label" style={{ color: theme.colors.textInverse, opacity: 0.9 }}>
              {eyebrow.toUpperCase()}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {status ? <RaceStatusBadge status={status} onImage /> : null}
      </View>

      <View style={styles.bottom}>
        <Text variant="heroTitle" style={{ color: theme.colors.textInverse }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" style={{ color: theme.colors.textInverse, opacity: 0.9 }}>
            {subtitle}
          </Text>
        ) : null}

        {stats && stats.length > 0 ? (
          <View style={styles.stats}>
            {stats.map((s) => (
              <Stat
                key={s.label}
                value={s.value}
                label={s.label}
                color="textInverse"
                labelColor="textInverse"
              />
            ))}
          </View>
        ) : null}

        {children}
      </View>

      {actionLabel && onAction ? (
        <View style={styles.fab}>
          <FloatingActionButton
            label={actionLabel}
            icon="arrowRight"
            onPress={onAction}
            accessibilityLabel={actionLabel}
          />
        </View>
      ) : null}
    </View>
  );

  const containerStyle = {
    height,
    borderRadius: theme.radius.xl,
    overflow: 'hidden' as const,
  };

  if (imageUri) {
    return (
      <View style={containerStyle}>
        <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }]} />
        {content}
      </View>
    );
  }

  return (
    <View style={[containerStyle, { backgroundColor: theme.colors.accentSecondary }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bottom: { gap: 6 },
  stats: { flexDirection: 'row', gap: 24, marginTop: 12 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
