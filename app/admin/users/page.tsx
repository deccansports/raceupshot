import { AdminLayout } from "@/components/admin-layout";
import { RolesAdmin } from "@/components/roles-admin";
import { listRoleAssignments, listRoleUsers } from "@/lib/admin-roles";
import { getStoredUserCount } from "@/lib/raceupshot-repository";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function UsersAndRolesPage() {
  const [storedUserCount, users, assignments, events] = await Promise.all([
    getStoredUserCount(),
    listRoleUsers(),
    listRoleAssignments(),
    getEvents({ includeUnpublished: true }),
  ]);
  return (
    <AdminLayout>
      <main className="admin-content">
        <div className="admin-title"><div><h1>Users & roles</h1><p>Event-scoped access with server-enforced permissions.</p></div></div>
        <RolesAdmin
          storedUserCount={storedUserCount}
          initialUsers={users}
          initialAssignments={assignments}
          events={events.map((event) => ({ id: event.id, name: event.name }))}
        />
      </main>
    </AdminLayout>
  );
}
