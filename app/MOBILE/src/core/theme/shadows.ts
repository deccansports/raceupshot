import { Platform, type ViewStyle } from 'react-native';

/** Elevation tokens producing soft, premium shadows. */
export type ElevationVariant = 'card' | 'floating' | 'modal';

const shadow = (native: ViewStyle, webBoxShadow: string): ViewStyle =>
  Platform.OS === 'web'
    ? ({ boxShadow: webBoxShadow } as ViewStyle)
    : native;

export const shadows: Record<ElevationVariant, ViewStyle> = {
  card: shadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  }, '0 2px 8px rgba(0,0,0,0.08)'),
  floating: shadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  }, '0 6px 16px rgba(0,0,0,0.14)'),
  modal: shadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  }, '0 12px 28px rgba(0,0,0,0.22)'),
};
