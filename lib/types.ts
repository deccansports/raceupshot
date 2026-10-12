export type EventStatus = "draft" | "live" | "upcoming" | "completed" | "official" | "provisional" | "archived";

export interface RaceEvent {
  id: string;
  slug: string;
  name: string;
  date: string;
  dateIso: string;
  endsAt?: string;
  location: string;
  city: string;
  venue: string;
  venueAddress?: string;
  organizerAddress?: string;
  jurisdiction?: string;
  sport: string;
  status: EventStatus;
  categories: string[];
  tickets?: Array<{ id: string; name: string; participationMode?: "INDIVIDUAL" | "RELAY"; relayTeamSize?: 2 | 3 | null }>;
  ticketDefinitions?: import('./event-ticket-definition').EventTicketDefinition[];
  participants: number;
  accent: string;
  shortCode: string;
  description: string;
  startTime?: string;
  organizer?: string;
  companyDescription?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
  registrationUrl?: string;
  knowMoreUrl?: string;
  broadcastUrl?: string;
  rulesUrl?: string;
  rulesHtml?: string;
  waiverHtml?: string;
  waiverVersion?: string;
  waiverPolicy?: import("./event-waiver-policy").EventWaiverPolicy;
  waiverParameterMappings?: import("./waiver-template").WaiverParameterMapping[];
  athleteGuidebookUrl?: string;
  logoUrl?: string;
  bannerUrl?: string;
  latitude?: string;
  longitude?: string;
  hasResults: boolean;
}

export interface EventPartner {
  id: string;
  name: string;
  logoUrl: string;
  website?: string;
  type?: string;
  order: number;
}

export interface Athlete {
  id: string;
  athleteUid?: string;
  email?: string;
  name: string;
  bib: string;
  gender: string;
  ageGroup: string;
  club: string;
  city: string;
  country: string;
  category: string;
  rank: number;
  genderRank: number;
  ageRank: number;
  finishTime: string;
  pace: string;
  status: string;
  lastSplit: string;
  eventId: string;
  eventSlug: string;
  eventName: string;
  splits: RaceSplit[];
  verificationCode?: string;
  certificateUrl?: string;
  visibility?: "PUBLIC" | "ANONYMOUS" | "PRIVATE";
}

export interface RaceSplit {
  label: string;
  time: string;
}

export interface HomepageSlide {
  id: string;
  eventId?: string;
  eventSlug?: string;
  eventName: string;
  headline: string;
  description: string;
  image: string;
  imageName?: string;
  primaryLabel?: string;
  primaryUrl?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
  enabled: boolean;
  order: number;
}

export interface AuditEntry {
  id: string;
  time: string;
  actor: string;
  action: string;
  entity: string;
  ip: string;
  severity: "normal" | "warning" | "critical";
}
