// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CategoryForm } from '@/components/category-form';
import { legacyTicketDefinition, type EventTicketDefinition } from '@/lib/event-ticket-definition';

function Harness() {
  const [tickets, setTickets] = useState<EventTicketDefinition[]>([legacyTicketDefinition('Duathlon')]);
  return <CategoryForm categories={['Duathlon']} onChange={() => undefined} ticketDefinitions={tickets} onTicketDefinitionsChange={setTickets} />;
}

describe('category sport-leg selection', () => {
  it('supports admin-selected bike and run legs and removes deselected legs', () => {
    render(<Harness />);
    const bike = screen.getByRole('checkbox', { name: 'Bike' });
    const run = screen.getByRole('checkbox', { name: 'Run' });
    const swim = screen.getByRole('checkbox', { name: 'Swim' });

    fireEvent.click(bike);
    fireEvent.click(run);
    expect((bike as HTMLInputElement).checked).toBe(true);
    expect((run as HTMLInputElement).checked).toBe(true);
    expect((swim as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Duathlon leg 1 name') as HTMLInputElement).value).toBe('Bike');
    expect((screen.getByLabelText('Duathlon leg 2 name') as HTMLInputElement).value).toBe('Run');

    fireEvent.click(bike);
    expect((bike as HTMLInputElement).checked).toBe(false);
    expect((run as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Duathlon leg 1 name') as HTMLInputElement).value).toBe('Run');
  });
});
