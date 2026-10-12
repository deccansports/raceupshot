import { AthleteAuthLoader } from "@/components/athlete-auth-loader";
import { AthleteLoginStory } from "@/components/athlete-login-story";
import { Logo } from "@/components/logo";
import { getCmsSiteSettings } from "@/lib/raceupshot-repository";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account login — Race Upshot",
  description: "Sign in to your linked Race Upshot admin, athlete, or volunteer account.",
};

export const dynamic = "force-dynamic";

export default async function AthleteLoginPage() {
  const settings = await getCmsSiteSettings({ publicFallback: true });
  return (
    <main className="athlete-auth-page">
      <div className="auth-brand"><Logo /><Link href="/">Back to website</Link></div>
      <div className="auth-layout">
        <AthleteLoginStory media={settings.loginMedia} />
        <AthleteAuthLoader />
      </div>
    </main>
  );
}
