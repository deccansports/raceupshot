export type AccountRole = "ADMIN" | "ATHLETE" | "VOLUNTEER";

const ROLE_DESTINATIONS: Record<AccountRole, string> = {
  ADMIN: "/admin",
  ATHLETE: "/athlete",
  VOLUNTEER: "/volunteer",
};

const ROLE_PRIORITY: AccountRole[] = ["ADMIN", "ATHLETE", "VOLUNTEER"];

export function accountDestination(roles: readonly AccountRole[]): string | null {
  const selected = ROLE_PRIORITY.find((role) => roles.includes(role));
  return selected ? ROLE_DESTINATIONS[selected] : null;
}
