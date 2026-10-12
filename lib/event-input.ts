import { z } from "./zod";
import { waiverParameterSources } from "./waiver-template";
import { eventTicketDefinitionSchema } from './event-ticket-definition';
import { eventWaiverPolicySchema } from './event-waiver-policy';

export const eventInput = z.object({
  name: z.string().min(3),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  sport: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().optional(),
  city: z.string().min(2),
  venue: z.string().min(2),
  venueAddress: z.string().max(500).optional(),
  organizerAddress: z.string().max(500).optional(),
  jurisdiction: z.string().max(200).optional(),
  organizer: z.string().optional(),
  companyDescription: z.string().max(1_000).optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  websiteUrl: z.string().optional(),
  registrationUrl: z.string().optional(),
  knowMoreUrl: z.string().optional(),
  broadcastUrl: z.string().optional(),
  rulesUrl: z.string().optional(),
  rulesHtml: z.string().max(100_000).optional(),
  waiverHtml: z.string().max(150_000).optional(),
  waiverVersion: z.string().trim().max(100).optional(),
  waiverPolicy: eventWaiverPolicySchema.optional(),
  waiverParameterMappings: z.array(z.object({
    token: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/),
    source: z.string().refine((source) => waiverParameterSources.some((item) => item.value === source)),
    customValue: z.string().max(2_000).optional(),
  })).max(100).optional(),
  athleteGuidebookUrl: z.string().optional(),
  athleteGuidebookData: z.string()
    .max(7_100_000)
    .refine((value) => !value || /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/.test(value), "Upload a valid PDF guidebook.")
    .optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  description: z.string().optional(),
  logoData: z.string().optional(),
  bannerData: z.string().optional(),
  categories: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  ticketDefinitions: z.array(eventTicketDefinitionSchema).max(50).default([]),
});
