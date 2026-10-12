import { LiveAthleteDetailRealtime } from "@/components/live-athlete-detail-realtime";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPlatformEvent, getPublicLiveParticipant } from "@/lib/platform-repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventAthletePage({
  params,
}: {
  params: Promise<{ slug: string; participantUid: string }>;
}) {
  const { slug, participantUid } = await params;
  const [event, read] = await Promise.all([
    getPlatformEvent(slug),
    getPublicLiveParticipant(slug, participantUid),
  ]);
  if (!event || !read) notFound();
  return <><SiteHeader /><LiveAthleteDetailRealtime event={event} initialAthlete={read.data} initialStale={read.isStale} /><SiteFooter /></>;
}
