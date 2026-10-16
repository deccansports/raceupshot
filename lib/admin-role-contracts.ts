export const ADMIN_ROLE_DEFINITIONS = [
  { id: "SUPER_ADMIN", name: "Super Admin", permissions: ["events", "imports", "results", "volunteers", "rfid", "cms", "certificates", "users", "audit"] },
  { id: "EVENT_ADMIN", name: "Event Admin", permissions: ["events", "imports", "results", "volunteers", "cms", "certificates", "audit"] },
  { id: "TIMING_OPERATOR", name: "Timing Operator", permissions: ["events", "imports", "results", "volunteers", "rfid", "audit"] },
  { id: "RESULT_MANAGER", name: "Result Manager", permissions: ["imports", "results", "certificates", "audit"] },
  { id: "CONTENT_EDITOR", name: "Content Editor", permissions: ["cms"] },
  { id: "VIEWER", name: "Viewer", permissions: ["events", "results"] },
] as const;

export type AdminRoleId = (typeof ADMIN_ROLE_DEFINITIONS)[number]["id"];
export type AdminRoleScope = "GLOBAL" | "EVENT";

export interface RoleUser {
  id: string;
  email: string;
  name: string;
}

export interface AdminRoleAssignment {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  roleId: AdminRoleId;
  roleName: string;
  scope: AdminRoleScope;
  eventIds: string[];
  createdAt: string;
  updatedAt: string;
}
