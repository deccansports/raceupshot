import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler, Linking, Platform, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';

import { useSession } from '@/core/auth/session';
import { useTheme } from '@/core/theme';
import { useMobileProfile } from '@/features/dashboard/hooks/useMobileAggregates';
import { Button, Card, Divider, Icon, ListItem, Screen, Text } from '@/shared/components';

const wordmark = require('../../../../assets/images/bm.png');

const ITEMS = [
  {
    key: 'about',
    title: 'About us',
    subtitle: 'Learn more about BERGMAN',
    url: 'https://bergmantri.com/about',
  },
  {
    key: 'contact',
    title: 'Contact us',
    subtitle: 'Get help from the BERGMAN team',
    url: 'https://bergmantri.com/contact-us',
  },
  { key: 'privacy', title: 'Privacy policy', subtitle: 'How your data is handled', href: '/privacy' },
  { key: 'terms', title: 'Terms of use', subtitle: 'Rules for using the app', href: '/terms' },
] as const;

export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 380;
  const status = useSession((state) => state.status);
  const profileQuery = useMobileProfile(status === 'authenticated');
  const isAdmin = profileQuery.data?.isAdmin === true || profileQuery.data?.role === 'admin';

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        router.replace('/');
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  return (
    <Screen scroll contentStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}>
      <View
        style={{
          minHeight: 184,
          borderRadius: 28,
          overflow: 'hidden',
          padding: 20,
          backgroundColor: '#F8FBFF',
          borderWidth: 1,
          borderColor: '#D8E6F7',
          justifyContent: 'space-between',
        }}>
        <View
          style={{
            position: 'absolute',
            right: -42,
            top: -28,
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: '#E9F3FF',
          }}
        />
        <View
          style={{
            flexDirection: isCompact ? 'column' : 'row',
            alignItems: isCompact ? 'flex-start' : 'center',
            gap: 14,
          }}>
          <View
            style={{
              width: 74,
              height: 74,
              borderRadius: 20,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: '#E1ECF8',
            }}>
            <Image
              source={wordmark}
              style={{ width: 62, height: 62 }}
              contentFit="contain"
              alt="BERGMAN"
              accessibilityLabel="BERGMAN"
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="caption" style={{ color: '#0B5CAB', fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
              BERGMAN
            </Text>
            <Text variant="display" style={{ color: '#0E1726', lineHeight: 38 }}>
              Settings
            </Text>
            <Text variant="bodySmall" color="textMuted">
              Explore app information, policies, and support.
            </Text>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: 8,
            rowGap: 8,
            marginTop: 16,
          }}>
          {['About', 'Contact', 'Privacy', 'Terms'].map((label) => (
            <View
              key={label}
              style={{
                paddingHorizontal: 11,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: 'rgba(11,92,171,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(11,92,171,0.12)',
              }}>
              <Text
                variant="caption"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ color: '#0B5CAB', fontWeight: '800' }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <Card style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        <Text variant="label" color="textMuted">
          INFORMATION
        </Text>
        <Text variant="headline">Everything in one place</Text>
        <Text variant="body" color="textMuted">
          Use these pages to review BERGMAN app details, reach support, and read the policy documents.
        </Text>
      </Card>

      <Card padded={false} style={{ overflow: 'hidden', marginTop: theme.spacing.sm }}>
        {isAdmin ? (
          <>
            <ListItem
              title="Admin Live Tracking Test"
              subtitle="Run the private web and mobile tracking simulator"
              trailing={<Icon name="chevronRight" color="textMuted" />}
              onPress={() => router.push('/admin-live-test')}
            />
            <Divider inset={theme.spacing.base} />
          </>
        ) : null}
        {ITEMS.map((item, index) => (
          <View key={item.key}>
            {index > 0 ? <Divider inset={theme.spacing.base} /> : null}
            <ListItem
              title={item.title}
              subtitle={item.subtitle}
              trailing={<Icon name="chevronRight" color="textMuted" />}
              onPress={() => {
                if ('url' in item && item.url) {
                  void Linking.openURL(item.url);
                  return;
                }
                if (item.href) {
                  router.push(item.href);
                }
              }}
            />
          </View>
        ))}
      </Card>

      <Card style={{ gap: theme.spacing.base, marginTop: theme.spacing.sm }}>
        <Text variant="label" color="textMuted">
          QUICK ACTIONS
        </Text>
        <Button
          label="Open Website"
          variant="secondary"
          fullWidth
          onPress={() => {
            void Linking.openURL('https://bergmantri.com');
          }}
        />
        <Button
          label="Back to Home"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/')}
        />
      </Card>

      <Text variant="caption" color="textMuted" center style={{ marginTop: theme.spacing.sm }}>
        BERGMAN Race · Settings
      </Text>
    </Screen>
  );
}
