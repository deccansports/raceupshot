import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { NotificationModel, NotificationType } from '@/core/repositories';
import { useTheme, type SemanticColors } from '@/core/theme';
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  Text,
  type IconName,
} from '@/shared/components';
import { useResponsive } from '@/shared/hooks';

import { useNotifications } from '../hooks/useNotifications';

const TYPE_META: Record<NotificationType, { icon: IconName; color: keyof SemanticColors }> = {
  raceAlert: { icon: 'bell', color: 'statusLive' },
  athleteUpdate: { icon: 'user', color: 'accentSecondary' },
  system: { icon: 'trophy', color: 'statusUpcoming' },
};

function NotificationRow({ item, onPress }: { item: NotificationModel; onPress: () => void }) {
  const theme = useTheme();
  const meta = TYPE_META[item.type];
  const color = theme.colors[meta.color];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityState={{ selected: !item.read }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: theme.spacing.md,
        padding: theme.spacing.base,
        alignItems: 'flex-start',
      }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${color}22`,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name={meta.icon} color={meta.color} size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" style={{ fontWeight: item.read ? '500' : '700' }} numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
          {item.body}
        </Text>
        <Text variant="caption" color="textMuted">
          {item.timeLabel.toUpperCase()}
        </Text>
      </View>
      {!item.read ? (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.colors.accent,
            marginTop: 6,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function NotificationsScreen() {
  const theme = useTheme();
  const { isTablet } = useResponsive();
  const {
    groups,
    unreadCount: unread,
    markRead,
    markAllRead,
    isLoading,
    isError,
    refetch,
  } = useNotifications();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.lg,
          maxWidth: isTablet ? theme.maxContentWidth : undefined,
          alignSelf: 'center',
          width: '100%',
        }}
        showsVerticalScrollIndicator={false}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Text variant="display">Alerts</Text>
            <Text variant="body" color="textMuted">
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </Text>
          </View>
          {unread > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
              onPress={markAllRead}
              hitSlop={8}>
              <Text variant="label" color="accent">
                MARK ALL READ
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isLoading ? (
          <View style={{ gap: theme.spacing.sm }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={76} radius={theme.radius.large} />
            ))}
          </View>
        ) : isError ? (
          <ErrorState description="We couldn't load alerts." onRetry={() => refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            description="Follow athletes to get live race alerts here when they start, hit key splits, and finish."
            icon={<Icon name="bell" size={40} color="textMuted" />}
          />
        ) : null}

        {!isLoading &&
          !isError &&
          groups.map((group) => (
            <View key={group.title} style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="textMuted">
                {group.title.toUpperCase()}
              </Text>
              <Card padded={false} style={{ overflow: 'hidden' }}>
                {group.data.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? (
                      <View
                        style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: 68 }}
                      />
                    ) : null}
                    <NotificationRow item={item} onPress={() => markRead(item.id)} />
                  </View>
                ))}
              </Card>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
