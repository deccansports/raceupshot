import { describe, expect, it } from "vitest";
import { eventDocumentSrcDoc, sanitizeEventDocumentHtml } from "../lib/event-document";

describe("styled event documents", () => {
  const source = `<!doctype html>
    <html class="dark"><head>
      <script>window.bad = true</script>
      <style>:root{--blue:#0B5ED7}.rules-block{color:var(--blue);padding:28px}</style>
    </head><body><section class="rules-block"><h1>Rules</h1></section></body></html>`;

  it("keeps document CSS and custom classes while removing scripts", () => {
    const rendered = sanitizeEventDocumentHtml(source);

    expect(rendered).toContain("<style>");
    expect(rendered).toContain(".rules-block");
    expect(rendered).toContain('class="rules-block"');
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("window.bad");
  });

  it("preserves smooth scrolling while removing unsafe legacy CSS behavior properties", () => {
    const rendered = sanitizeEventDocumentHtml(`
      <style>
        html{scroll-behavior:smooth}
        .legacy{behavior:url(legacy.htc)}
        .binding{-moz-binding:url(binding.xml)}
      </style>
    `);

    expect(rendered).toContain("scroll-behavior:smooth");
    expect(rendered).not.toContain("behavior:url");
    expect(rendered).not.toContain("-moz-binding");
  });

  it("returns a complete sandbox-ready HTML document", () => {
    const rendered = eventDocumentSrcDoc(source);

    expect(rendered.toLowerCase()).toContain("<!doctype html>");
    expect(rendered).toContain("<html");
    expect(rendered).toContain("<body>");
    expect(rendered).toContain("box-sizing:border-box");
  });

  it("disables rules section navigation buttons", () => {
    const rendered = sanitizeEventDocumentHtml(`
      <nav>
        <a href="http://localhost:3001/events/test1/rules#triathlon" target="_blank">Triathlon Rules</a>
        <a href="/events/test1/rules#swimathon">Swimathon Rules</a>
      </nav>
      <section id="triathlon">Triathlon</section>
      <section id="swimathon">Swimathon</section>
    `);

    expect(rendered).not.toContain('href="#triathlon"');
    expect(rendered).not.toContain('href="#swimathon"');
    expect(rendered.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(rendered.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(rendered).not.toContain("localhost:3001");
    expect(rendered).not.toContain('target="_blank"');
  });
});
