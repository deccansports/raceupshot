import { AdminLoginForm } from "@/components/admin-login-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin login — Race Upshot",
  description: "Secure access to Race Upshot timing operations and event management.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLoginPage() {
  return <AdminLoginForm />;
}
