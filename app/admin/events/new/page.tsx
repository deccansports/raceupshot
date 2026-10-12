import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function NewEventPage() {
  redirect("/admin/events-registration?tab=event_info");
}
