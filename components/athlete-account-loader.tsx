"use client";

import dynamic from "next/dynamic";

const AthleteAccount = dynamic(
  () => import("./athlete-account").then((module) => module.AthleteAccount),
  { ssr: false, loading: () => <div className="account-loading"><span className="auth-spinner" /> Verifying your secure session…</div> },
);

export function AthleteAccountLoader() {
  return <AthleteAccount />;
}
