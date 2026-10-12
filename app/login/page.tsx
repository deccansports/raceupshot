import { ArrowRight, ClipboardCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Login — Race Upshot",
  description: "Sign in to your Race Upshot admin, athlete, or volunteer account.",
};

export default function LoginPage() {
  return (
    <main className="athlete-auth-page portal-login-page">
      <div className="auth-brand"><Logo /><Link href="/">Back to website</Link></div>
      <section className="portal-login-card" aria-labelledby="portal-login-title">
        <span className="eyebrow blue">ACCOUNT LOGIN</span>
        <h1 id="portal-login-title">Choose your account</h1>
        <p>Use one secure account login. Race Upshot will automatically open your linked access.</p>
        <div className="portal-login-options">
          <Link href="/athlete/login">
            <UserRound aria-hidden="true" />
            <span><b>Account login</b><small>Admin, athlete and linked volunteer access</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/volunteer">
            <ClipboardCheck aria-hidden="true" />
            <span><b>Volunteer-only login</b><small>Use volunteer OTP or volunteer password</small></span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
