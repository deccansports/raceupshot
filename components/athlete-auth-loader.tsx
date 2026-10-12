"use client";

import dynamic from "next/dynamic";

const AthleteAuth = dynamic(
  () => import("./athlete-auth").then((module) => module.AthleteAuth),
  { ssr: false, loading: () => <div className="account-loading"><span className="auth-spinner" /> Preparing secure login…</div> },
);

export function AthleteAuthLoader() {
  return <AthleteAuth />;
}
