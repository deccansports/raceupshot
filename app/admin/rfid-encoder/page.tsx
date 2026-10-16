import { AdminLayout } from "@/components/admin-layout";
import { RfidEncoderAdmin } from "@/components/rfid-encoder-admin";

export const dynamic = "force-dynamic";

export default function RfidEncoderPage() {
  return <AdminLayout><main className="admin-content"><div className="admin-title"><div><h1>RFID Chip Encoder</h1><p>Read, write, encode and verify RFID timing chips.</p></div></div><RfidEncoderAdmin /></main></AdminLayout>;
}
