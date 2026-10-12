import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { z } from "./zod";
import { escapeEmailHtml, sendBergtecnoEmail, textToEmailHtml } from "./bergtecno-email";
import { BERGTECNO_TEMPLATES } from "./email-templates";

const PREFIX = "raceupshot";

export const contactEnquiryInput = z.object({
  name: z.string().trim().min(2).max(100),
  organization: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(5).max(30),
  eventName: z.string().trim().min(2).max(160),
  eventType: z.string().trim().min(2).max(80),
  eventDate: z.string().trim().min(8).max(30),
  expectedParticipants: z.coerce.number().int().min(1).max(1_000_000),
  city: z.string().trim().min(2).max(100),
  requiredServices: z.string().trim().min(2).max(160),
  message: z.string().trim().min(5).max(5_000),
});

export type ContactEnquiryInput = z.infer<typeof contactEnquiryInput>;

export interface EnquiryReply {
  id: string;
  subject: string;
  message: string;
  status: "QUEUED" | "SENT" | "FAILED";
  createdAt: string;
  sentAt?: string;
  error?: string;
}

export interface ContactEnquiry extends ContactEnquiryInput {
  id: string;
  status: "OPEN" | "REPLIED";
  createdAt: string;
  replies: EnquiryReply[];
  confirmation?: {
    status: "SENT" | "FAILED";
    attemptedAt: string;
    error?: string;
  };
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  return env.RACEUPSHOT;
}

async function getIndex(kv: KVNamespace): Promise<string[]> {
  return (await kv.get<string[]>(`${PREFIX}:enquiries:index`, "json")) ?? [];
}

export async function createEnquiry(input: ContactEnquiryInput): Promise<ContactEnquiry> {
  const kv = await getKv();
  const id = crypto.randomUUID();
  const enquiry: ContactEnquiry = {
    ...input,
    email: input.email.toLowerCase(),
    id,
    status: "OPEN",
    createdAt: new Date().toISOString(),
    replies: [],
  };
  const ids = await getIndex(kv);
  await Promise.all([
    kv.put(`${PREFIX}:enquiry:${id}`, JSON.stringify(enquiry)),
    kv.put(`${PREFIX}:enquiries:index`, JSON.stringify([id, ...ids.filter((item) => item !== id)])),
  ]);

  const delivery = await sendBergtecnoEmail({
    recipientEmail: enquiry.email,
    templateId: BERGTECNO_TEMPLATES.contactTicket.uuid,
    variables: {
      ticketId: enquiry.id,
      fullName: enquiry.name,
      organization: enquiry.organization,
      email: enquiry.email,
      mobile: enquiry.phone,
      eventDate: enquiry.eventDate,
      message: enquiry.message,
      year: new Date().getFullYear(),
    },
  });
  enquiry.confirmation = {
    status: delivery.sent ? "SENT" : "FAILED",
    attemptedAt: new Date().toISOString(),
    ...(delivery.sent ? {} : { error: delivery.error || "Contact confirmation delivery failed." }),
  };
  await kv.put(`${PREFIX}:enquiry:${id}`, JSON.stringify(enquiry));
  return enquiry;
}

export async function listEnquiries(limit = 10): Promise<ContactEnquiry[]> {
  const kv = await getKv();
  const ids = (await getIndex(kv)).slice(0, Math.max(0, limit));
  const rows = await Promise.all(ids.map((id) => kv.get<ContactEnquiry>(`${PREFIX}:enquiry:${id}`, "json")));
  return rows
    .filter((row): row is ContactEnquiry => Boolean(row))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function replyToEnquiry(id: string, subject: string, message: string): Promise<ContactEnquiry> {
  const kv = await getKv();
  const key = `${PREFIX}:enquiry:${id}`;
  const enquiry = await kv.get<ContactEnquiry>(key, "json");
  if (!enquiry) throw new Error("Enquiry not found.");

  const reply: EnquiryReply = {
    id: crypto.randomUUID(),
    subject,
    message,
    status: "QUEUED",
    createdAt: new Date().toISOString(),
  };
  enquiry.replies = [...(enquiry.replies || []), reply];
  await kv.put(key, JSON.stringify(enquiry));

  const delivery = await sendBergtecnoEmail({
    recipientEmail: enquiry.email,
    subject,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17223a;line-height:1.65">
      <div style="max-width:640px;margin:auto;padding:28px">
        <h2 style="color:#ff6b22">Race Upshot</h2>
        <p>Hello ${escapeEmailHtml(enquiry.name)},</p>
        <p>${textToEmailHtml(message)}</p>
        <hr style="border:0;border-top:1px solid #e6e9ef;margin:24px 0">
        <p style="color:#687188;font-size:13px">Regarding: ${escapeEmailHtml(enquiry.eventName)}</p>
        <p style="color:#687188;font-size:13px">Race Upshot · info@raceupshot.com</p>
      </div>
    </body></html>`,
  });

  const updatedReply: EnquiryReply = delivery.sent
    ? { ...reply, status: "SENT", sentAt: new Date().toISOString() }
    : { ...reply, status: "FAILED", error: delivery.error || "Delivery failed." };
  enquiry.replies = enquiry.replies.map((item) => item.id === reply.id ? updatedReply : item);
  if (delivery.sent) enquiry.status = "REPLIED";
  await kv.put(key, JSON.stringify(enquiry));
  return enquiry;
}
