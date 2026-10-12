import { LiveRaceOperationsScreen } from './LiveRaceOperationsScreen';

export function FinishLineScreen({ eventId }: { eventId: string }) {
  return <LiveRaceOperationsScreen eventId={eventId} mode="finish" />;
}
