import Link from "next/link";
import { ArrowUpRight, Mail, MapPin } from "lucide-react";
import { Logo } from "./logo";
import { getCmsSiteSettings } from "@/lib/raceupshot-repository";
import { connection } from "next/server";

export async function SiteFooter() {
  await connection();
  const settings = await getCmsSiteSettings({ publicFallback: true });
  return (
    <footer className="site-footer">
      <div className="footer-cta shell">
        <div>
          <span className="eyebrow blue">BUILT FOR RACE DAY</span>
          <h2>Every second deserves certainty.</h2>
        </div>
        <Link href="/contact" className="button button-lime">
          Plan your event <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="footer-main shell">
        <div className="footer-brand">
          <Logo inverse />
          <p>{settings.footer.tagline}</p>
        </div>
        {settings.footer.columns.map((column) => (
          <div key={column.id}>
            <h4>{column.title}</h4>
            {column.links.map((link) => <Link href={link.url} key={link.id}>{link.label}</Link>)}
          </div>
        ))}
        <div>
          <h4>Connect</h4>
          <a href={`mailto:${settings.footer.email}`}><Mail size={15} /> {settings.footer.email}</a>
          <span><MapPin size={15} /> {settings.footer.location}</span>
        </div>
      </div>
      <div className="footer-bottom shell">
        <span>© 2026 Race Upshot</span>
        <nav className="footer-policy-links" aria-label="App privacy policies">
          <Link href="/privacy/tracking">Tracking app privacy</Link>
          <Link href="/privacy/volunteer">Volunteer app privacy</Link>
        </nav>
        <span>Timing engineered at the edge.</span>
      </div>
    </footer>
  );
}
