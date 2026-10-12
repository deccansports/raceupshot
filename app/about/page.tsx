import { CmsPublicPage } from "@/components/cms-public-page";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPublishedCmsPage } from "@/lib/raceupshot-repository";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedCmsPage("about");
  return {
    title: page ? `${page.title} — Race Upshot` : "About — Race Upshot",
    description: page?.description,
  };
}

export default async function AboutPage() {
  const page = await getPublishedCmsPage("about");
  if (!page) notFound();
  return (
    <>
      <SiteHeader />
      <CmsPublicPage page={page} />
      <SiteFooter />
    </>
  );
}
