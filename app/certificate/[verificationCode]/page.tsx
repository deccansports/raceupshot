import { CertificateView } from "@/components/certificate-view";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { certificateTemplateId } from "@/lib/certificate-storage";
import { findCertificate, getCertificateTemplates } from "@/lib/raceupshot-repository";

export default async function CertificatePage({ params }: { params: Promise<{ verificationCode: string }> }) {
  const { verificationCode } = await params;
  const certificate = await findCertificate(verificationCode);
  const templates = certificate ? await getCertificateTemplates() : [];
  const template = certificate
    ? templates.find((item) => certificateTemplateId(item.eventSlug, item.category) === certificateTemplateId(certificate.event.slug, certificate.athlete.category)) ?? null
    : null;
  return (
    <>
      <SiteHeader />
      <main className="certificate-page">
        <div className="shell"><CertificateView verificationCode={verificationCode} certificate={certificate} template={template} /></div>
      </main>
      <SiteFooter />
    </>
  );
}
