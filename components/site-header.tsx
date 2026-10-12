"use client";

import Link from "next/link";
import { Menu, Search, X } from "lucide-react";
import { useState } from "react";
import { AccountSwitcher } from "./account-switcher";
import { Logo } from "./logo";

const nav = [
  ["Events", "/events"],
  ["Results", "/results"],
  ["Live", "/live"],
  ["Services", "/services"],
  ["About", "/about"],
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Logo />
        <nav className={open ? "nav-links open" : "nav-links"} aria-label="Primary navigation">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <Link href="/contact" className="nav-contact" onClick={() => setOpen(false)}>
            Time my event <span>↗</span>
          </Link>
        </nav>
        <div className="nav-actions">
          <Link href="/results" aria-label="Search">
            <Search size={19} />
          </Link>
          <AccountSwitcher />
          <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-label="Toggle menu">
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}
