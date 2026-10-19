import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

type AthletePushData = {
  type?: string;
  eventId?: string;
  bib?: string;
  athleteId?: string;
  participantUuid?: string;
  route?: string;
  actionUrl?: string;
  activeVersion?: string;
  timingVersion?: number;
  splitKey?: string;
};

/**
 * Routes push-notification taps directly to the relevant athlete
 * (athlete started / split complete / finished / podium, etc.).
 */
export function useNotificationDeepLinks() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    let removeSubscriptions = () => {};
    void import('expo-notifications').then((Notifications) => {
      if (!active) return;
      // Native notifications are not visibly presented while the app is in
      // the foreground unless a handler explicitly opts in. Keep timing
      // alerts visible and audible in both foreground and background states.
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      const refreshCanonicalTiming = (data: AthletePushData | undefined) => {
        if (!data?.eventId) return;
        // The Worker publishes canonical KV before sending the alert. Refetch
        // immediately, with short bounded retries for cross-PoP KV propagation.
        const refresh = () => {
          void queryClient.invalidateQueries({
            predicate: ({ queryKey }) => (
              (queryKey[0] === 'canonical-live' && queryKey[1] === data.eventId)
              || (queryKey[0] === 'tracking' && queryKey[2] === data.eventId)
              || (queryKey[0] === 'events' && queryKey[2] === data.eventId)
            ),
          });
        };
        refresh();
        const timers = [350, 1_000, 2_500].map((delay) => setTimeout(refresh, delay));
        return () => timers.forEach(clearTimeout);
      };
      const openNotification = (response: any) => {
        if (!response) return;
        const data = response.notification.request.content.data as AthletePushData | undefined;
        refreshCanonicalTiming(data);
        const isAthleteTiming = [
          'athleteUpdate',
          'athlete_start',
          'split',
          'split_crossed',
          'finish',
          'leg_update',
          'race_status',
        ]
          .includes(String(data?.type || ''));
        if (isAthleteTiming && data?.eventId && (data?.bib || data?.athleteId || data?.participantUuid)) {
          // Timing alerts always reopen the main event Tracker with the exact
          // athlete selected. They must not route to the separate generic
          // athlete-profile screen.
          router.push({
            pathname: '/event/[eventId]/track',
            params: {
              eventId: data.eventId,
              bib: data.bib || '',
              participantUuid: data.participantUuid || data.athleteId || '',
            },
          });
          return;
        }
        if (data?.type === 'announcement') {
          if (data.eventId) router.push({ pathname: '/event/[eventId]', params: { eventId: data.eventId } });
          else router.push('/');
        }
      };
      const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        refreshCanonicalTiming(notification.request.content.data as AthletePushData | undefined);
      });
      const responseSub = Notifications.addNotificationResponseReceivedListener(openNotification);
      void Notifications.getLastNotificationResponseAsync().then(openNotification).catch(() => {});
      removeSubscriptions = () => {
        receivedSub.remove();
        responseSub.remove();
        Notifications.setNotificationHandler(null);
      };
    }).catch(() => {});
    return () => {
      active = false;
      removeSubscriptions();
    };
  }, [queryClient, router]);
}
