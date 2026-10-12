import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { AdminNav } from "./admin-nav";
import { SiteHeader } from "./site-header";

export async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!await isAdminAuthenticated()) redirect("/admin/login");
  return (
    <div className="admin-shell">
      <SiteHeader />
      <div className="admin-main">
        <section className="admin-hub" aria-label="Admin dashboard navigation">
          <h1>Admin Dashboard</h1>
          <AdminNav />
        </section>
        {children}
      </div>
    </div>
  );
}
