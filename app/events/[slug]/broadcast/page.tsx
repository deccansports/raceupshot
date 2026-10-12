import { PublicBroadcastPortal } from "@/components/public-broadcast-portal";
import { getPublicLiveBroadcast } from "@/lib/live-broadcast";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const broadcast = await getPublicLiveBroadcast(slug);
  return {
    title: broadcast?.title || "Race Upshot Live Broadcast",
    description: broadcast?.subtitle || broadcast?.message || "Watch official Race Upshot event coverage.",
    openGraph: broadcast?.posterUrl ? { images: [broadcast.posterUrl] } : undefined,
  };
}

export default async function LiveBroadcastPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const broadcast = await getPublicLiveBroadcast(slug);
  if (!broadcast) notFound();
  return <PublicBroadcastPortal broadcast={broadcast} />;
}
