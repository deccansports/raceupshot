import { AdminLayout } from "@/components/admin-layout";
import { EnquiriesManager } from "@/components/enquiries-manager";
import { listEnquiries } from "@/lib/enquiries";

export const dynamic = "force-dynamic";

export default async function AdminEnquiriesPage() {
  const enquiries = await listEnquiries(10);
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Enquiries</h1><p>Review incoming event-service enquiries.</p></div></div>
        <EnquiriesManager initialEnquiries={enquiries} />
      </main>
    </AdminLayout>
  );
}
