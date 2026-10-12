import { redirect } from "next/navigation";

export default async function EventResultsAlias({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/results/${slug}`);
}
