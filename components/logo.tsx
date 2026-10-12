import Image from "next/image";
import Link from "next/link";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" className={`logo ${inverse ? "logo-inverse" : ""}`} aria-label="Race Upshot home">
      <Image
        className="brand-logo-image"
        src="/Race Upshot logo.png"
        alt="Race Upshot"
        width={658}
        height={194}
        priority
      />
      <Image
        className="brand-icon-image"
        src="/favicon race upshot.png"
        alt=""
        width={118}
        height={118}
        aria-hidden="true"
      />
    </Link>
  );
}
