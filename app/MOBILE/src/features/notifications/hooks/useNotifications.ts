import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { repositories, type NotificationModel } from '@/core/repositories';
import { queryClient } from '@/core/services/query/queryClient';

export type NotificationGroup = { title: string; data: NotificationModel[] };

const notificationsKey = ['notifications'] as const;

/** Notifications state is sourced from the backend and cached by React Query. */
export function useNotifications() {
  const query = useQuery({
    queryKey: notificationsKey,
    queryFn: ({ signal }) => repositories.notifications.getNotifications(signal),
    staleTime: 60 * 1000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: notificationsKey });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => repositories.notifications.markRead(id),
    onSuccess: invalidate,
  });
  const markAllReadMutation = useMutation({
    mutationFn: () => repositories.notifications.markAllRead(),
    onSuccess: invalidate,
  });

  const items = useMemo(() => query.data ?? [], [query.data]);

  const groups = useMemo<NotificationGroup[]>(() => {
    return [
      { title: 'Today', data: items.filter((n) => n.group === 'Today') },
      { title: 'Earlier', data: items.filter((n) => n.group === 'Earlier') },
    ].filter((g) => g.data.length > 0);
  }, [items]);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = (id: string) => markReadMutation.mutate(id);
  const markAllRead = () => markAllReadMutation.mutate();

  return {
    groups,
    unreadCount,
    markRead,
    markAllRead,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
