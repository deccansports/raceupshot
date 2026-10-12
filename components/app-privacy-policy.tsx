import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export type PrivacyPolicySection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export function AppPrivacyPolicyPage({
  appName,
  summary,
  sections,
  otherPolicyHref,
  otherPolicyLabel,
}: {
  appName: string;
  summary: string;
  sections: PrivacyPolicySection[];
  otherPolicyHref: string;
  otherPolicyLabel: string;
}) {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <span className="eyebrow blue">RACE UPSHOT · PRIVACY</span>
            <h1>{appName} Privacy Policy</h1>
            <p>{summary}</p>
          </div>
        </section>
        <section className="page-section shell">
          <article className="privacy-policy">
            <p className="privacy-policy-updated">Last updated: 9 October 2026</p>
            <p>
              This notice explains how Race Upshot handles personal information when you use the {appName}. It should be read together with any privacy notice provided by the organizer of an event you enter or work at.
            </p>
            {sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets?.length ? (
                  <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : null}
              </section>
            ))}
            <section className="privacy-policy-related">
              <h2>Other Race Upshot app</h2>
              <p>This policy is specific to the {appName}. See the separate notice for the other app.</p>
              <Link href={otherPolicyHref} className="button button-lime">
                {otherPolicyLabel} <ArrowUpRight size={16} />
              </Link>
            </section>
          </article>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
