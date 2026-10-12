import { AdminLayout } from "@/components/admin-layout";
import { VolunteerManagementAdmin } from "@/components/volunteer-management-admin";
import {
  listVolunteerActivity,
  listVolunteerCheckIns,
  listVolunteerEventOptions,
  listVolunteerManualTimingWithRanks,
  listVolunteers,
} from "@/lib/volunteer-management";

export const dynamic = "force-dynamic";

export default async function VolunteerManagementPage() {
  const [volunteers, events, activity, checkIns, manualTiming] = await Promise.all([
    listVolunteers(),
    listVolunteerEventOptions(),
    listVolunteerActivity(),
    listVolunteerCheckIns(),
    listVolunteerManualTimingWithRanks(),
  ]);
  return (
    <AdminLayout>
      <main className="admin-content">
        <VolunteerManagementAdmin
          initialVolunteers={volunteers}
          events={events}
          initialActivity={activity}
          initialCheckIns={checkIns}
          initialManualTiming={manualTiming}
        />
      </main>
    </AdminLayout>
  );
}
