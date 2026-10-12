export function canReserveResultNotificationClaim(
  oldStatus: string | undefined,
  retryFailed = false,
  forceResend = false,
): boolean {
  if (!oldStatus) return true;
  if (oldStatus === "SENDING") return false;
  if (forceResend) return true;
  return retryFailed && oldStatus === "FAILED";
}
