export const MIN_FEIBOT_RESULT_FETCH_SECONDS = 30;
export const MAX_FEIBOT_RESULT_FETCH_SECONDS = 3_600;

export function normalizedFeibotResultFetchSeconds(value: number): number {
  if (!Number.isFinite(value)) return MIN_FEIBOT_RESULT_FETCH_SECONDS;
  return Math.min(
    MAX_FEIBOT_RESULT_FETCH_SECONDS,
    Math.max(MIN_FEIBOT_RESULT_FETCH_SECONDS, Math.round(value)),
  );
}
