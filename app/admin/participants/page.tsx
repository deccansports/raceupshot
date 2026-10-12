import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminParticipantsPage() {
  redirect("/admin/events-registration?tab=participants");
}
