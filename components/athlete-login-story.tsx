"use client";

import type { CmsLoginMedia } from "@/lib/cms";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

export function AthleteLoginStory({ media }: { media: CmsLoginMedia[] }) {
  const items = useMemo(() => media.filter((item) => item.enabled && item.src), [media]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % items.length), 7000);
    return () => window.clearInterval(timer);
  }, [items.length]);

  return (
    <section className={`auth-story ${items.length ? "has-media" : ""}`}>
      {items.length > 0 && (
        <div className="auth-story-media" aria-hidden="true">
          {items.map((item, index) => (
            <div className={index === activeIndex % items.length ? "active" : ""} key={item.id}>
              {item.type === "video"
                ? <video src={item.src} autoPlay muted loop playsInline />
                : <Image src={item.src} alt="" fill sizes="(min-width: 1024px) 55vw, 100vw" unoptimized priority={index === 0} />}
            </div>
          ))}
        </div>
      )}
      <div className="auth-story-shade" />
      <div className="auth-story-copy">
        <span className="eyebrow blue">ONE SECURE ACCOUNT</span>
        <h2>Your races.<br />Your results.<br /><em>Always yours.</em></h2>
        <p>Access official timing, certificates and live tracking from one athlete identity.</p>
        <div className="auth-story-signal"><i /><span>Secure athlete access · Race Upshot timing</span></div>
      </div>
      {items.length > 1 && (
        <div className="auth-story-dots">
          {items.map((item, index) => <button key={item.id} className={index === activeIndex % items.length ? "active" : ""} onClick={() => setActiveIndex(index)} aria-label={`Show login background ${index + 1}`} />)}
        </div>
      )}
    </section>
  );
}
