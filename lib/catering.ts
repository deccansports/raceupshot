import { z } from './zod';
import { volunteerBandIdentifier } from './volunteer-band-identifier';

export const cateringServiceSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'ITEM']),
  active: z.boolean(),
  athletesEligible: z.boolean(),
  volunteersEligible: z.boolean(),
  categories: z.array(z.string().trim().min(1).max(120)).max(100),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  totalServings: z.number().int().min(1).max(1000000),
  maxPerRecipient: z.number().int().min(1).max(100),
  inventoryQuantity: z.number().positive(),
  unit: z.string().trim().min(1).max(30),
  purchaseRatePaisa: z.number().int().min(0).max(100000000),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(row => Date.parse(row.endsAt) > Date.parse(row.startsAt), 'End must follow start.');
export type CateringService = z.infer<typeof cateringServiceSchema>;
export const cateringVolunteerGroupSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  type: z.enum(['VOLUNTEER_GROUP', 'ADMIN_TAG']),
  servingDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
  allowedMeals: z.array(z.enum(['BREAKFAST', 'LUNCH', 'DINNER'])).min(1).max(3),
  bandCodes: z.array(z.string().trim().min(1).max(250)).max(1000),
  active: z.boolean(),
});
export type CateringVolunteerGroup = z.infer<typeof cateringVolunteerGroupSchema>;
export type CateringRecipient = { id: string; name: string; identifier: string; audience: 'ATHLETE' | 'VOLUNTEER'; category: string; groupId?: string; groupType?: CateringVolunteerGroup['type'] };
export type CateringIssue = {
  id: string; serviceId: string; serviceName: string; kind: CateringService['kind'];
  recipient: CateringRecipient; operatorId: string; operatorName: string; issuedAt: string;
  quantity: number; unit: string; costPaisa: number;
  status?: 'ISSUED' | 'RESET'; resetAt?: string; resetBy?: string;
};
export type CateringSnapshot = { services: CateringService[]; counts: Record<string, number>; recent: CateringIssue[]; volunteerDates: string[]; volunteerGroups: CateringVolunteerGroup[] };

export function cateringBandIdentifier(value: string): string {
  return volunteerBandIdentifier(value);
}

export function assertCateringIssue(service: CateringService, recipient: CateringRecipient, used: number, issued: number, now = Date.now()) {
  if (!service.active) throw new Error('This service is disabled.');
  if (now < Date.parse(service.startsAt) || now >= Date.parse(service.endsAt)) throw new Error('This service is outside its configured serving window.');
  if (recipient.audience === 'VOLUNTEER' ? !service.volunteersEligible : !service.athletesEligible) throw new Error('This recipient is not eligible.');
  if (recipient.audience === 'ATHLETE' && service.categories.length && !service.categories.some(category => category.toLowerCase() === recipient.category.toLowerCase())) throw new Error('This category is not eligible.');
  if (used >= service.maxPerRecipient) throw new Error('Already served: recipient allowance reached.');
  if (issued >= service.totalServings) throw new Error('No servings remain.');
}

export function cateringMetrics(service: CateringService, issued: number) {
  const quantityPerServing = service.inventoryQuantity / service.totalServings;
  return { issued, remaining: Math.max(0, service.totalServings - issued), quantityPerServing,
    consumedQuantity: quantityPerServing * issued,
    remainingQuantity: Math.max(0, service.inventoryQuantity - quantityPerServing * issued),
    consumedCostPaisa: Math.round(quantityPerServing * issued * service.purchaseRatePaisa),
  };
}
