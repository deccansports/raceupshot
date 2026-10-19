import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Icon } from '../ui/Icon';
import { Stat } from '../ui/Stat';
import { Text } from '../ui/Text';
import { RaceStatusBadge } from './RaceStatusBadge';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type LiveEventCardProps = {
  title: string;
  athleteCount: string;
  actionLabel?: string;
  imageUri?: string;
  onPress?: () => void;
};

/** High-emphasis live event card: edge-to-edge image, LIVE badge, big stat, CTA. */
export function LiveEventCard({
  title,
  athleteCount,
  actionLabel = 'Live Tracking',
  imageUri,
  onPress,
}: LiveEventCardProps) {
  const theme = useTheme();
  const press = usePressScale(0.99);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, live, ${athleteCount} athletes`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        press.style,
        theme.shadows.card,
        { borderRadius: theme.radius.xl, overflow: 'hidden' },
      ]}>
      <View style={{ minHeight: 180, backgroundColor: theme.colors.accent }}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }]} />
        <View style={styles.body}>
          <RaceStatusBadge status="live" onImage />
          <View style={{ gap: 8 }}>
            <Text variant="heroTitle" style={{ color: theme.colors.textInverse }} numberOfLines={2}>
              {title}
            </Text>
            <View style={styles.footer}>
              <Stat
                value={athleteCount}
                label="Athletes"
                color="textInverse"
                labelColor="textInverse"
              />
              <View style={styles.cta}>
                <Text variant="label" style={{ color: theme.colors.textInverse }}>
                  {actionLabel.toUpperCase()}
                </Text>
                <Icon name="arrowRight" size={18} color="textInverse" />
              </View>
            </View>
          </View>
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 20, justifyContent: 'space-between', gap: 24 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
