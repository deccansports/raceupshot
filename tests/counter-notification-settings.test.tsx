// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CounterNotificationSettings } from '../components/counter-notification-settings';
import { emptyCounterTemplate } from '../lib/counter-notification-contract';

describe('counter notification settings', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps an email parameter input mounted while its name is typed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: { template: emptyCounterTemplate('WAIVER_VERIFY'), deliveries: [] },
    })));
    render(<CounterNotificationSettings events={[{ id: 'event-1', name: 'Race' }]} />);

    const input = await screen.findByLabelText('Email parameter 1') as HTMLInputElement;
    await waitFor(() => expect((input.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false));
    input.focus();
    fireEvent.change(input, { target: { value: 'n' } });
    expect(screen.getByLabelText('Email parameter 1')).toBe(input);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'name' } });
    expect(screen.getByLabelText('Email parameter 1')).toBe(input);
    expect(input.value).toBe('name');
  });
});
