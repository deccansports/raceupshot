import { z } from "./zod";

export const cmsBlockSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  html: z.string(),
});

export const cmsPageSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens"),
  path: z.string(),
  description: z.string().max(320),
  blocks: z.array(cmsBlockSchema).max(50),
  status: z.enum(["Published", "Draft"]),
  access: z.enum(["Public", "Private"]),
  placements: z.array(z.string()),
  footerCategory: z.string(),
  order: z.number(),
  updatedAt: z.string(),
  published: z.object({
    title: z.string(),
    description: z.string(),
    blocks: z.array(cmsBlockSchema),
    publishedAt: z.string(),
  }).optional(),
});

const cmsFooterLinkSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  url: z.string().min(1).max(1000),
});

export const cmsSiteSettingsSchema = z.object({
  loginMedia: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(["image", "video"]),
    src: z.string().min(1).max(3_000_000),
    alt: z.string().max(200),
    enabled: z.boolean(),
    order: z.number(),
  })).max(12),
  footer: z.object({
    tagline: z.string().max(320),
    email: z.string().max(200),
    location: z.string().max(200),
    columns: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(80),
      links: z.array(cmsFooterLinkSchema).max(20),
    })).min(1).max(6),
  }),
});
