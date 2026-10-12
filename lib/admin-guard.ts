import { apiFailure } from "./api-response";
import { isAdminAuthenticated } from "./admin-auth";

export async function requireAdmin() {
  return await isAdminAuthenticated() ? null : apiFailure("Admin authentication required.", 401);
}
