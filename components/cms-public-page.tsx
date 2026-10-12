import type { CmsPublishedSnapshot } from "@/lib/cms";

export function CmsPublicPage({ page }: { page: CmsPublishedSnapshot }) {
  return (
    <main className="cms-public-content">
      {page.blocks.map((block) => (
        <div
          className="cms-public-block"
          key={block.id}
          data-cms-block={block.name}
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      ))}
    </main>
  );
}
