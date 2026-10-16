import { AdminLayout } from "@/components/admin-layout";
import { VolunteerManagementAdmin } from "@/components/volunteer-management-admin";
import {
  listVolunteerActivity,
  listVolunteerCheckIns,
  listVolunteerEventOptions,
  listVolunteerManualTimingWithRanks,
  listVolunteers,
} from "@/lib/volunteer-management";
import { listVolunteerCustomCounterIssues, listVolunteerCustomCounters } from "@/lib/volunteer-custom-counters";

export const dynamic = "force-dynamic";

export default async function VolunteerManagementPage() {
  const [volunteers, events, activity, checkIns, manualTiming, customCounters, customCounterIssues] = await Promise.all([
    listVolunteers(),
    listVolunteerEventOptions(),
    listVolunteerActivity(),
    listVolunteerCheckIns(),
    listVolunteerManualTimingWithRanks(),
    listVolunteerCustomCounters(),
    listVolunteerCustomCounterIssues(),
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
          initialCustomCounters={customCounters}
          initialCustomCounterIssues={customCounterIssues}
        />
      </main>
    </AdminLayout>
  );
}
