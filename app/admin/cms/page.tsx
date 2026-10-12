import { AdminLayout } from "@/components/admin-layout";
import { CmsManager } from "@/components/cms-manager";
import { getCmsPages, getCmsSiteSettings, getEvents, getHomepageSliderConfig } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export default async function CmsPage() {
  const [events, slider, pages, siteSettings] = await Promise.all([
    getEvents({ includeUnpublished: true }),
    getHomepageSliderConfig(),
    getCmsPages(),
    getCmsSiteSettings(),
  ]);
  return <AdminLayout><main className="admin-content"><div className="admin-title"><div><h1>Content management</h1><p>Manage website pages, event content, homepage media and navigation.</p></div></div><CmsManager events={events} slides={slider.slides} sliderEnabled={slider.enabled} initialPages={pages} initialSiteSettings={siteSettings} /></main></AdminLayout>;
}
