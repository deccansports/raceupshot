export const BERGTECNO_TEMPLATES = {
  loginOtp: {
    legacyId: 1,
    uuid: "00a54957-141f-49aa-aa7b-98186d45554f",
  },
  resultsPublished: {
    legacyId: 18,
    uuid: "5516589c-c988-4768-bf44-c4a49d5912c8",
  },
  contactTicket: {
    legacyId: 20,
    uuid: "b95dceac-bfbc-4575-be3e-73793125cbb3",
  },
  waiverCheckin: {
    legacyId: 34,
    uuid: "d93bdb49-79e5-42bb-b433-cf4285f9adf4",
  },
} as const;

export function resolveBergtecnoTemplateId(value: string) {
  const templateId = value.trim();
  const legacyId = templateId.match(/^#?(\d+)$/)?.[1];
  if (!legacyId) return templateId;
  const template = Object.values(BERGTECNO_TEMPLATES).find((candidate) => String(candidate.legacyId) === legacyId);
  return template?.uuid ?? templateId;
}
