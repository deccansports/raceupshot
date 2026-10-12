import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Privacy Policy — Race Upshot",
  description: "How Race Upshot handles personal information across its website, athlete services, timing platform, and volunteer operations.",
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="inner-hero">
          <div className="shell">
            <span className="eyebrow blue">RACE UPSHOT · PRIVACY</span>
            <h1>Privacy Policy</h1>
            <p>How Race Upshot handles information across its website, athlete services, timing platform, and race-day operations.</p>
          </div>
        </section>
        <section className="page-section shell">
          <article className="privacy-policy">
            <p className="privacy-policy-updated">Last updated: 9 October 2026</p>
            <p>This notice explains how Race Upshot processes personal information when you browse our website, enter or follow an event, use athlete services, contact us, or interact with race-day operations. Event organizers may provide an additional privacy notice for information they collect or control.</p>

            <section>
              <h2>Information we process</h2>
              <p>Depending on the service used, we may process contact and account details, event-registration information, race category and BIB details, timing reads, results, waiver and check-in status, communications, and limited technical information needed to secure and operate the service.</p>
            </section>
            <section>
              <h2>How we use information</h2>
              <p>We use information to provide event registration and athlete services, authenticate users, support timing and race operations, publish live tracking and official results, send requested or operational communications, maintain security and audit records, and respond to enquiries.</p>
            </section>
            <section>
              <h2>Sharing and service providers</h2>
              <p>We do not sell personal information. Information may be shared with the relevant event organizer, authorized race staff, timing providers, and infrastructure, authentication, email, mapping, notification, or support providers where needed to deliver the service. We may also disclose information where required by law or necessary to protect users, race integrity, or service security.</p>
            </section>
            <section>
              <h2>Public race information</h2>
              <p>Race participation, BIB, category, timing reads, rankings, and results may be published according to event settings and organizer requirements. Where supported, athletes can choose public or anonymous display for live tracking. Official result and race-history records may still need to be retained.</p>
            </section>
            <section>
              <h2>Retention, security, and your choices</h2>
              <p>We retain information for as long as needed to provide services, preserve official results and race history, meet audit or legal requirements, and maintain platform security. We use reasonable technical and organizational safeguards, but no online system can guarantee absolute security.</p>
              <p>You may request access, correction, or deletion by emailing <a href="mailto:info@raceupshot.com">info@raceupshot.com</a>. Some registration, waiver, timing, and official-result records may need to be retained by Race Upshot or the event organizer.</p>
            </section>
            <section>
              <h2>Children</h2>
              <p>Some events include junior athletes. A parent, guardian, or event organizer should provide and manage a minor&apos;s information where required. Contact Race Upshot and the relevant organizer if information about a child was submitted in error or needs correction.</p>
            </section>
            <section>
              <h2>App-specific notices</h2>
              <p>Our athlete tracking and volunteer applications have additional notices describing their particular permissions, device storage, and operational data.</p>
              <div className="privacy-policy-actions">
                <Link href="/privacy/tracking" className="button button-lime">Tracking app privacy <ArrowUpRight size={16} /></Link>
                <Link href="/privacy/volunteer" className="button">Volunteer app privacy <ArrowUpRight size={16} /></Link>
              </div>
            </section>
            <section>
              <h2>Contact</h2>
              <p>For privacy questions or requests, email <a href="mailto:info@raceupshot.com">info@raceupshot.com</a>. For event-specific registration or official-result information, you may also contact the event organizer.</p>
            </section>
          </article>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
