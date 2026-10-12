import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { Image } from 'expo-image';

import { useTheme } from '@/core/theme';
import { avatarColor, getInitials } from '@/core/utils';

import { Text } from './Text';

export type AvatarProps = {
  name: string;
  uri?: string | number | Record<string, unknown>;
  size?: number;
  /**
   * Seed for the deterministic background color (same athlete → same color).
   * Defaults to `name`; pass the athlete id for stability across name changes.
   */
  colorSeed?: string;
  /** White ring + soft shadow (used for the live-map marker / prominent uses). */
  bordered?: boolean;
};

/**
 * Circular athlete avatar. Priority: profile photo (`uri`) → deterministic
 * initials avatar (colored circle from `colorSeed`/`name`).
 */
export function Avatar({ name, uri, size = 44, colorSeed, bordered = false }: AvatarProps) {
  const theme = useTheme();
  const [failedSourceKey, setFailedSourceKey] = useState<string | null>(null);
  const imageSource = useMemo(() => normalizeImageSource(uri, size), [size, uri]);
  const imageSourceKey = imageSourceKeyFor(imageSource);
  const showImage = imageSource !== null && failedSourceKey !== imageSourceKey;
  const bg = avatarColor(colorSeed ?? name);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${name} avatar`}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        bordered && {
          borderWidth: 2,
          borderColor: theme.colors.textInverse,
        },
        bordered && theme.shadows.card,
      ]}>
      {showImage ? (
        <Image
          source={imageSource}
          onError={() => setFailedSourceKey(imageSourceKey)}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : (
        <Text
          variant="label"
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            color: '#FFFFFF',
            fontSize: size * 0.36,
            lineHeight: size * 0.44,
            textAlign: 'center',
            includeFontPadding: false,
            // iOS can clip bold initials when the inherited label line-height
            // is smaller than the avatar-specific font size.
            paddingTop: Platform.OS === 'ios' ? size * 0.015 : 0,
          }}>
          {getInitials(name)}
        </Text>
      )}
    </View>
  );
}

function optimizeRemoteAvatarUri(uri: string, size: number): string {
  if (!/^https:\/\/images\.unsplash\.com\//i.test(uri)) return uri;
  if (/[?&](?:w|h)=/i.test(uri)) return uri;
  const pixels = Math.max(96, Math.ceil(size * 3));
  const separator = uri.includes('?') ? '&' : '?';
  return `${uri}${separator}auto=format&fit=crop&w=${pixels}&h=${pixels}&q=80`;
}

function normalizeImageSource(uri: AvatarProps['uri'] | undefined, size: number): string | number | { uri: string } | null {
  if (uri === undefined || uri === null) return null;

  if (typeof uri === 'number') return uri;
  if (typeof uri === 'string') {
    const text = uri.trim();
    return text ? { uri: optimizeRemoteAvatarUri(text, size) } : null;
  }

  if (typeof uri === 'object' && 'uri' in uri) {
    const candidate = (uri as Record<string, unknown>).uri;
    return typeof candidate === 'string' && candidate.trim()
      ? { uri: optimizeRemoteAvatarUri(candidate.trim(), size) }
      : null;
  }

  return null;
}

function imageSourceKeyFor(source: string | number | { uri: string } | null): string {
  if (source === null) return '';
  if (typeof source === 'number') return String(source);
  if (typeof source === 'string') return source;
  return source.uri;
}
