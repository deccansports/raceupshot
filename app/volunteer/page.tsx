import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Volunteer portal — Race Upshot",
  description: "Secure event-scoped race operations for Race Upshot volunteers.",
};

export default function VolunteerPortalPage() {
  redirect("/volunteer-app/index.html");
}
