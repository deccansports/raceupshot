export interface CmsContentBlock {
  id: string;
  name: string;
  html: string;
}

export interface CmsPublishedSnapshot {
  title: string;
  description: string;
  blocks: CmsContentBlock[];
  publishedAt: string;
}

export interface CmsPageRecord {
  id: string;
  title: string;
  slug: string;
  path: string;
  description: string;
  blocks: CmsContentBlock[];
  status: "Published" | "Draft";
  access: "Public" | "Private";
  placements: string[];
  footerCategory: string;
  order: number;
  updatedAt: string;
  published?: CmsPublishedSnapshot;
}

export interface CmsLoginMedia {
  id: string;
  type: "image" | "video";
  src: string;
  alt: string;
  enabled: boolean;
  order: number;
}

export interface CmsFooterLink {
  id: string;
  label: string;
  url: string;
}

export interface CmsFooterColumn {
  id: string;
  title: string;
  links: CmsFooterLink[];
}

export interface CmsSiteSettings {
  loginMedia: CmsLoginMedia[];
  footer: {
    tagline: string;
    email: string;
    location: string;
    columns: CmsFooterColumn[];
  };
}

export const defaultCmsSiteSettings: CmsSiteSettings = {
  loginMedia: [
    {
      id: "login-race-photo-1",
      type: "image",
      src: "https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/images%20Bm%20for%20websites%2FBRMD00351.JPG?alt=media&token=46ab0875-2668-4861-9e38-06cd50747751",
      alt: "Athletes on a Race Upshot race course",
      enabled: true,
      order: 1,
    },
    {
      id: "login-race-photo-2",
      type: "image",
      src: "https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/images%20Bm%20for%20websites%2FBRMD00679.JPG?alt=media&token=dc7e5560-0791-45c9-8eb8-4ad92c118f3c",
      alt: "Race-day athlete experience",
      enabled: true,
      order: 2,
    },
  ],
  footer: {
    tagline: "Precision timing and live race intelligence for endurance events across India.",
    email: "info@raceupshot.com",
    location: "India · Nationwide",
    columns: [
      {
        id: "explore",
        title: "Explore",
        links: [
          { id: "live", label: "Live timing", url: "/live" },
          { id: "athlete-login", label: "Athlete login", url: "/athlete/login" },
        ],
      },
      {
        id: "company",
        title: "Company",
        links: [
          { id: "about", label: "About", url: "/about" },
          { id: "contact", label: "Contact", url: "/contact" },
        ],
      },
      {
        id: "races",
        title: "Races",
        links: [
          { id: "events", label: "Events", url: "/events" },
          { id: "results", label: "Results", url: "/results" },
          { id: "services", label: "Services", url: "/services" },
        ],
      },
      {
        id: "legal",
        title: "Legal",
        links: [{ id: "privacy", label: "Privacy", url: "/privacy-policy" }],
      },
    ],
  },
};

const defaultAboutBlocks: CmsContentBlock[] = [
  {
    id: "about-intro",
    name: "Introduction",
    html: `<section class="cms-content-hero">
  <span class="cms-kicker">ABOUT RACE UPSHOT</span>
  <h1>Built for the truth of the finish line.</h1>
  <p>We believe race timing should feel invisible to athletes and completely dependable to organizers.</p>
</section>`,
  },
  {
    id: "about-mission",
    name: "Mission and values",
    html: `<section class="cms-content-section">
  <div class="cms-content-heading">
    <div>
      <span class="cms-kicker">OUR MISSION</span>
      <h2>Make every result clear and trusted.</h2>
    </div>
    <p>Race Upshot brings timing hardware, race-day operations, public results and athlete storytelling into one precise technology platform.</p>
  </div>
  <div class="cms-content-grid">
    <article class="cms-content-card">
      <span class="cms-card-number">01</span>
      <h3>Precision</h3>
      <p>Decisions anchored in verified timing data.</p>
    </article>
    <article class="cms-content-card">
      <span class="cms-card-number">02</span>
      <h3>Modern systems</h3>
      <p>Edge-native infrastructure built for scale.</p>
    </article>
    <article class="cms-content-card">
      <span class="cms-card-number">03</span>
      <h3>Earned trust</h3>
      <p>Transparent statuses and auditable publication.</p>
    </article>
    <article class="cms-content-card">
      <span class="cms-card-number">04</span>
      <h3>Wide coverage</h3>
      <p>Support for endurance events across India.</p>
    </article>
  </div>
</section>`,
  },
];

const defaultAboutPublished: CmsPublishedSnapshot = {
  title: "About Us",
  description: "About Race Upshot.",
  blocks: defaultAboutBlocks,
  publishedAt: "2026-01-01T00:00:00.000Z",
};

export const coreCmsPages: CmsPageRecord[] = [
  {
    id: "core-about",
    title: defaultAboutPublished.title,
    slug: "about",
    path: "/about",
    description: defaultAboutPublished.description,
    blocks: defaultAboutBlocks,
    status: "Published",
    access: "Public",
    placements: ["Header"],
    footerCategory: "Company",
    order: 1,
    updatedAt: defaultAboutPublished.publishedAt,
    published: defaultAboutPublished,
  },
];

const allowedClasses = [
  "cms-content-hero",
  "cms-content-section",
  "cms-content-heading",
  "cms-content-grid",
  "cms-content-card",
  "cms-card-number",
  "cms-kicker",
  "cms-button",
  "cms-button-primary",
  "cms-callout",
  "cms-two-column",
  "cms-muted",
];

const allowedTags = new Set([
  "section", "article", "div", "span", "h1", "h2", "h3", "h4",
  "p", "strong", "b", "em", "i", "small", "ul", "ol", "li",
  "a", "blockquote", "figure", "figcaption", "img", "hr", "br",
  "code", "pre",
]);

const globalAttributes = new Set(["class", "id", "aria-label"]);
const tagAttributes: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
};
const voidTags = new Set(["img", "hr", "br"]);

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeUrl(value: string, tag: string): boolean {
  const compact = value.replace(/[\u0000-\u0020]+/g, "");
  if (!compact || (compact.startsWith("/") && !compact.startsWith("//")) || compact.startsWith("#")) return true;
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (tag === "img" && scheme === "data") return /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(compact);
  return ["http", "https", "mailto", "tel"].includes(scheme);
}

function sanitizeTag(tagName: string, rawAttributes: string, closing: boolean): string {
  const tag = tagName.toLowerCase();
  if (!allowedTags.has(tag)) return "";
  if (closing) return voidTags.has(tag) ? "" : `</${tag}>`;

  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawAttributes))) {
    const name = match[1].toLowerCase();
    if (!globalAttributes.has(name) && !tagAttributes[tag]?.has(name)) continue;
    let attributeValue = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "class") {
      attributeValue = attributeValue.split(/\s+/).filter((className) => allowedClasses.includes(className)).join(" ");
      if (!attributeValue) continue;
    }
    if ((name === "href" || name === "src") && !safeUrl(attributeValue, tag)) continue;
    if (name === "target" && attributeValue !== "_blank" && attributeValue !== "_self") continue;
    attributes.set(name, attributeValue);
  }
  if (tag === "a" && attributes.get("target") === "_blank") attributes.set("rel", "noopener noreferrer");
  if (tag === "img" && !attributes.has("loading")) attributes.set("loading", "lazy");
  const serialized = [...attributes].map(([name, attributeValue]) => ` ${name}="${escapeAttribute(attributeValue)}"`).join("");
  return `<${tag}${serialized}>`;
}

export function sanitizeCmsHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g, (tagMarkup, tagName: string, rawAttributes: string) => (
      sanitizeTag(tagName, rawAttributes, /^<\s*\//.test(tagMarkup))
    ))
    .trim();
}

export function sanitizeCmsBlocks(blocks: CmsContentBlock[]): CmsContentBlock[] {
  return blocks.map((block, index) => ({
    id: block.id || `block-${index + 1}`,
    name: block.name.trim() || `Content block ${index + 1}`,
    html: sanitizeCmsHtml(block.html),
  }));
}
