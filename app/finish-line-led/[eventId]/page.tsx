import { FinishLineLedDisplay } from "@/components/finish-line-led-display";
import { getFinishLineLedFeed } from "@/lib/finish-line-led";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FinishLineLedPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const feed = await getFinishLineLedFeed(eventId);
  if (!feed) notFound();
  return <FinishLineLedDisplay initialFeed={feed} />;
}
