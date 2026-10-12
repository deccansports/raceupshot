import { PlatformLiveEvent } from "@/components/platform-live-event";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function EventAthletesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <><SiteHeader /><PlatformLiveEvent eventSlug={slug} /><SiteFooter /></>;
}
