import { ContactForm } from "@/components/contact-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const turnstileSiteKey = await getTurnstileSiteKey();
  return <>
    <SiteHeader /><main>
      <section className="inner-hero"><div className="shell"><span className="eyebrow blue">PLAN YOUR EVENT</span><h1>Let’s make race day certain.</h1><p>Tell us what you are building. We will shape the timing, results and technical operation around your course and participants.</p></div></section>
      <section className="page-section shell"><ContactForm turnstileSiteKey={turnstileSiteKey} /></section>
    </main><SiteFooter />
  </>;
}
