import { describe, expect, it } from 'vitest';
import { BERGTECNO_TEMPLATES, resolveBergtecnoTemplateId } from '../lib/email-templates';

describe('Bergtecno email templates', () => {
  it('maps waiver template #34 to its provider UUID', () => {
    expect(resolveBergtecnoTemplateId('#34')).toBe(BERGTECNO_TEMPLATES.waiverCheckin.uuid);
    expect(resolveBergtecnoTemplateId('34')).toBe(BERGTECNO_TEMPLATES.waiverCheckin.uuid);
  });
});
