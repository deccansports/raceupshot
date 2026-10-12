import sanitizeHtml from "sanitize-html";

const documentTags = [
  "html", "head", "body", "title", "meta", "style",
  "main", "header", "footer", "nav", "section", "article", "aside",
  "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "strong", "b", "em", "i", "small", "ul", "ol", "li",
  "a", "blockquote", "figure", "figcaption", "img", "picture", "source",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "hr", "br", "code", "pre",
];

function sanitizeStyleSheets(html: string): string {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_tag, attributes: string, css: string) => {
    const safeCss = css
      .replace(/@import\b[^;]*(?:;|$)/gi, "")
      .replace(/@charset\b[^;]*(?:;|$)/gi, "")
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/(?:javascript|vbscript)\s*:/gi, "")
      .replace(/(^|[;{]\s*)(?:behavior|-moz-binding)\s*:[^;}]*;?/gim, "$1")
      .replace(/url\s*\(\s*(['"]?)\s*(?:data|javascript|vbscript):[\s\S]*?\1\s*\)/gi, "none");
    return `<style${attributes}>${safeCss}</style>`;
  });
}

const documentBaseStyles = "<style>*,*::before,*::after{box-sizing:border-box}.rules-nav a[aria-disabled=\"true\"]{pointer-events:none;cursor:not-allowed;opacity:.55}</style>";

function inPageRulesHref(href: string | undefined): string | undefined {
  if (!href || href.startsWith("#")) return href;
  try {
    const url = new URL(href, "https://event-document.local");
    if (url.hash && /^\/events\/[^/]+\/rules\/?$/i.test(url.pathname)) return url.hash;
  } catch {
    // The sanitizer will handle malformed URLs.
  }
  return href;
}

export function sanitizeEventDocumentHtml(source: string): string {
  const withoutActiveContent = sanitizeStyleSheets(source)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|iframe|object|embed|template|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(input|button|textarea|select)\b[^>]*\/?>/gi, "");

  return sanitizeHtml(withoutActiveContent, {
    allowedTags: documentTags,
    allowedAttributes: {
      "*": ["class", "id", "style", "title", "role", "aria-label"],
      html: ["lang", "class"],
      meta: ["charset", "name", "content"],
      a: ["href", "target", "rel", "aria-disabled", "tabindex"],
      img: ["src", "srcset", "sizes", "alt", "width", "height", "loading"],
      source: ["src", "srcset", "sizes", "type", "media"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      source: ["http", "https", "data"],
    },
    allowProtocolRelative: false,
    allowVulnerableTags: true,
    parseStyleAttributes: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = inPageRulesHref(attributes.href);
        const attribs: Record<string, string> = { ...attributes };
        if (href) attribs.href = href;
        if (attributes.target === "_blank") attribs.rel = "noopener noreferrer";
        if (href?.startsWith("#")) {
          delete attribs.href;
          delete attribs.target;
          delete attribs.rel;
          attribs["aria-disabled"] = "true";
          attribs.tabindex = "-1";
        }
        return { tagName: "a", attribs };
      },
      img: (_tagName, attributes) => ({
        tagName: "img",
        attribs: { loading: "lazy", ...attributes },
      }),
    },
  }).trim();
}

export function eventDocumentSrcDoc(source: string): string {
  const sanitized = sanitizeEventDocumentHtml(source);
  if (/<html[\s>]/i.test(sanitized)) {
    const withBaseStyles = /<\/head\s*>/i.test(sanitized)
      ? sanitized.replace(/<\/head\s*>/i, `${documentBaseStyles}</head>`)
      : `${documentBaseStyles}${sanitized}`;
    return `<!doctype html>${withBaseStyles}`;
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    ${documentBaseStyles}
    <style>
      html{scroll-behavior:smooth}
      body{margin:0;padding:28px;font:14px/1.7 Inter,system-ui,sans-serif;color:#0f172a;background:#fff}
      h1,h2,h3,h4{line-height:1.2}
      img{max-width:100%;height:auto}
      table{width:100%;border-collapse:collapse}
      th,td{padding:9px;border:1px solid #d8e0e8;text-align:left}
      a{color:#0b5ed7}
    </style>
  </head>
  <body>${sanitized}</body>
</html>`;
}
