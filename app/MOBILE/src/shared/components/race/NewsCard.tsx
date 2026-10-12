import { View } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '@/core/theme';

import { Card } from '../ui/Card';
import { Text } from '../ui/Text';

export type NewsCardProps = {
  title: string;
  excerpt?: string;
  source?: string;
  dateLabel?: string;
  imageUri?: string;
  onPress?: () => void;
};

/** Editorial news/update card with optional cover image. */
export function NewsCard({ title, excerpt, source, dateLabel, imageUri, onPress }: NewsCardProps) {
  const theme = useTheme();

  return (
    <Card padded={false} onPress={onPress} style={{ overflow: 'hidden' }}>
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: '100%', height: 160 }}
          contentFit="cover"
        />
      ) : null}
      <View style={{ padding: theme.spacing.base, gap: theme.spacing.xs }}>
        {source || dateLabel ? (
          <Text variant="caption" color="accent">
            {[source, dateLabel].filter(Boolean).join('  ·  ').toUpperCase()}
          </Text>
        ) : null}
        <Text variant="headline" numberOfLines={2}>
          {title}
        </Text>
        {excerpt ? (
          <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
            {excerpt}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
