"use client";

import {
  Activity, BookOpen, ClipboardList, FileBadge2, FileText, Import, LayoutDashboard,
  Medal, Megaphone, Radio, RadioTower, Search, Settings, Shield, Tv, UserRoundCheck, Video, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const items = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/admin", group: "Race operations", keywords: "overview control centre" },
  { icon: BookOpen, label: "Events & registration", href: "/admin/events-registration", group: "Race operations", keywords: "events create edit course maps platform registrations event info participants results certificates bulk upload" },
  { icon: Radio, label: "Live tracking", href: "/admin/live-timing", group: "Race operations", keywords: "feibot timing athletes leaderboard course maps" },
  { icon: RadioTower, label: "RFID Chip Encoder", href: "/admin/rfid-encoder", group: "Race operations", keywords: "ru5600 epc tag chip reader writer bulk encoding inventory" },
  { icon: Video, label: "Live broadcast", href: "/admin/live-broadcast", group: "Race operations", keywords: "stream cameras cloudflare video recordings" },
  { icon: Tv, label: "Finish Line LED", href: "/admin/finish-line-led", group: "Race operations", keywords: "display finishers screen" },
  { icon: UserRoundCheck, label: "Volunteers", href: "/admin/volunteers", group: "Race operations", keywords: "volunteer assignments check-in manual timing timing points activity" },
  { icon: Medal, label: "Results", href: "/admin/results", group: "Race operations", keywords: "publish leaderboard timing" },
  { icon: Import, label: "Imports", href: "/admin/imports", group: "Content & engagement", keywords: "excel csv upload mapping" },
  { icon: FileBadge2, label: "Certificates", href: "/admin/certificates", group: "Content & engagement", keywords: "finisher certificate templates" },
  { icon: FileText, label: "CMS", href: "/admin/cms", group: "Content & engagement", keywords: "pages content website" },
  { icon: ClipboardList, label: "Enquiries", href: "/admin/enquiries", group: "Content & engagement", keywords: "contact support reply" },
  { icon: Megaphone, label: "Communications", href: "/admin/communications", group: "Content & engagement", keywords: "email campaign promotion audience notifications" },
  { icon: Shield, label: "Users & roles", href: "/admin/users", group: "Platform", keywords: "admin access permissions" },
  { icon: ClipboardList, label: "Audit logs", href: "/admin/audit-logs", group: "Platform", keywords: "history actions security" },
  { icon: Activity, label: "System health", href: "/admin/system-health", group: "Platform", keywords: "status diagnostics worker" },
  { icon: Settings, label: "Settings", href: "/admin/platform-settings", group: "Platform", keywords: "configuration privacy api" },
] as const;

const groups = ["Race operations", "Content & engagement", "Platform"] as const;

function isActive(pathname: string, label: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  if (label === "Events & registration" && pathname.startsWith("/admin/events/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [prefetchOnIntent, setPrefetchOnIntent] = useState<Set<string>>(() => new Set());
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      `${item.label} ${item.group} ${item.keywords}`.toLowerCase().includes(query),
    );
  }, [search]);
  const activeItem = items.find((item) => isActive(pathname, item.label, item.href));

  return (
    <nav className="admin-nav" aria-label="Admin sections">
      <div className="admin-nav-heading">
        <small>{filteredItems.length} admin sections shown</small>
      </div>
      <label className="admin-nav-search">
        <Search />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search admin tabs…"
          aria-label="Search admin tabs"
        />
        {search && <button type="button" aria-label="Clear tab search" onClick={() => setSearch("")}><X /></button>}
      </label>

      <select
        className="admin-nav-mobile-select"
        aria-label="Open admin section"
        value={activeItem?.href || ""}
        onChange={(event) => router.push(event.target.value)}
      >
        <option value="" disabled>Select a section…</option>
        {filteredItems.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}
      </select>

      <div className="admin-nav-groups">
        {groups.map((group) => {
          const groupItems = filteredItems.filter((item) => item.group === group);
          if (!groupItems.length) return null;
          return (
            <section key={group}>
              <h2>{group}</h2>
              <div>
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item.label, item.href);
                  const enablePrefetch = prefetchOnIntent.has(item.href);
                  const prefetchOnUserIntent = () => {
                    if (enablePrefetch) return;
                    setPrefetchOnIntent((current) => new Set(current).add(item.href));
                  };
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      prefetch={enablePrefetch ? null : false}
                      onMouseEnter={prefetchOnUserIntent}
                      onFocus={prefetchOnUserIntent}
                      className={active ? "active" : undefined}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!filteredItems.length && (
          <div className="admin-nav-empty">
            <Search />
            <strong>No matching tabs</strong>
            <small>Try another name or feature.</small>
          </div>
        )}
      </div>
    </nav>
  );
}
