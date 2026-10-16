"use client";

import type { CommunicationCampaign } from "@/lib/communications";
import type { RaceEvent } from "@/lib/types";
import type { WhatsAppCampaign } from "@/lib/whatsapp-campaigns";
import { Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { CommunicationsManager } from "./communications-manager";
import { WhatsAppCampaignsManager } from "./whatsapp-campaigns-manager";

export function CampaignCommunicationsManager({ events, initialCampaigns, initialWhatsAppCampaigns, initialEventId }: { events: RaceEvent[]; initialCampaigns: CommunicationCampaign[]; initialWhatsAppCampaigns: WhatsAppCampaign[]; initialEventId: string }) {
  const [channel, setChannel] = useState<"EMAIL" | "WHATSAPP">("EMAIL");
  return <div className="communications-stack"><div className="communication-scope"><button type="button" className={channel === "EMAIL" ? "active" : ""} onClick={() => setChannel("EMAIL")}><Mail /> Email campaigns</button><button type="button" className={channel === "WHATSAPP" ? "active" : ""} onClick={() => setChannel("WHATSAPP")}><MessageCircle /> WhatsApp campaigns</button></div>{channel === "EMAIL" ? <CommunicationsManager events={events} initialCampaigns={initialCampaigns} initialEventId={initialEventId} /> : <WhatsAppCampaignsManager events={events} initialCampaigns={initialWhatsAppCampaigns} initialEventId={initialEventId} />}</div>;
}
