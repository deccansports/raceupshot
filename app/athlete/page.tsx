import { AthleteAccountLoader } from "@/components/athlete-account-loader";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My athlete account — Race Upshot",
  description: "Manage your Race Upshot athlete account.",
};

export default function AthletePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero account-hero"><div className="shell"><span className="eyebrow blue">MY RACE UPSHOT</span><h1>Athlete account</h1><p>Your secure home for results, certificates and future race activity.</p></div></section>
        <section className="page-section account-page"><div className="shell"><AthleteAccountLoader /></div></section>
      </main>
      <SiteFooter />
    </>
  );
}
