import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Activity, Bike, FileBadge, Gauge, Radio, Route, Smartphone, Timer, Waves } from "lucide-react";

const services = [
  [Timer,"RFID race timing","Feibot RFID timing systems for start, split and finish capture with professional-grade operational support."],
  [Radio,"Real-time results","Live leaderboards and athlete updates built for phones, venue screens and race control."],
  [Route,"Athlete tracking","Progress at meaningful timing points with last-seen and estimated-finish context."],
  [Bike,"Multi-sport timing","Swim, transition, bike and run splits connected into one result."],
  [Waves,"Swim timing","Robust start-wave and open-water finish workflows for mass participation."],
  [FileBadge,"Digital certificates","Verified, shareable achievement certificates after final publication."],
  [Gauge,"Finish-line systems","Displays, clocks, timing mats and race-day technical infrastructure."],
  [Activity,"Event analytics","Participation, category, timing-read and result-quality reporting."],
  [Smartphone,"Mobile live tracking app","A dedicated iOS and Android race experience for live athletes, course maps, results, watchlists and event updates."],
  [Radio,"Active timing · Feibot systems","Active timing operations powered by Feibot, an international-standard RFID timing system for dependable reads, live race control and verified results."],
] as const;

export default function ServicesPage() {
  return <>
    <SiteHeader /><main>
      <section className="inner-hero"><div className="shell"><span className="eyebrow blue">END-TO-END RACE TECHNOLOGY</span><h1>One timing partner. Every race moment.</h1><p>From course design and hardware setup to live leaderboards and official certificates.</p></div></section>
      <section className="section shell"><div className="services-grid">{services.map(([Icon,title,text],i)=><article key={title}><span className="service-num">0{i+1}</span><Icon/><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    </main><SiteFooter />
  </>;
}
