import { redirect } from "next/navigation";

export default async function EventResultAlias({
  params,
}: {
  params: Promise<{ slug: string; resultId: string }>;
}) {
  const { slug, resultId } = await params;
  redirect(`/results/${slug}/athlete/${resultId}`);
}
