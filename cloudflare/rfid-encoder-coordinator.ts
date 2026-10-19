import { DurableObject } from 'cloudflare:workers';
import { applyRfidCommand, emptyRfidLedger, type RfidCommand, type RfidLedger } from '../lib/rfid-ledger';

type StoredRow = { kind: string; id: string; payload: string };

/**
 * Global serialization point for physical RFID writes.
 *
 * One instance is intentional: an EPC or TID must never be reserved by two
 * operators, events, or encoding computers at the same time.
 */
export class RfidEncoderCoordinator extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rfid_records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      )
    `);
  }

  initialize(seed: RfidLedger): boolean {
    return this.ctx.storage.transactionSync(() => {
      const existing = [...this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM rfid_records')][0]?.count ?? 0;
      if (existing > 0) return false;
      this.writeState(seed);
      return true;
    });
  }

  snapshot(): RfidLedger {
    return this.readState();
  }

  command(command: RfidCommand, operatorId: string, now = Date.now(), id = crypto.randomUUID()) {
    return this.ctx.storage.transactionSync(() => {
      const state = this.readState();
      const result = applyRfidCommand(state, command, operatorId, now, id);
      this.writeState(state);
      return { result, state };
    });
  }

  private readState(): RfidLedger {
    const state = emptyRfidLedger();
    for (const row of this.ctx.storage.sql.exec<StoredRow>('SELECT kind, id, payload FROM rfid_records ORDER BY updated_at DESC')) {
      const value = JSON.parse(row.payload) as never;
      if (row.kind === 'chip') state.chips.push(value);
      else if (row.kind === 'job') state.jobs.push(value);
      else if (row.kind === 'transaction') state.transactions.push(value);
    }
    return state;
  }

  private writeState(state: RfidLedger) {
    const now = new Date().toISOString();
    const keep = new Set<string>();
    const put = (kind: string, id: string, value: unknown) => {
      keep.add(`${kind}:${id}`);
      this.ctx.storage.sql.exec(
        'INSERT INTO rfid_records (kind, id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
        kind, id, JSON.stringify(value), now,
      );
    };
    state.chips.forEach((row) => put('chip', row.id, row));
    state.jobs.forEach((row) => put('job', row.id, row));
    state.transactions.forEach((row) => put('transaction', row.id, row));
    for (const row of this.ctx.storage.sql.exec<{ kind: string; id: string }>('SELECT kind, id FROM rfid_records')) {
      if (!keep.has(`${row.kind}:${row.id}`)) this.ctx.storage.sql.exec('DELETE FROM rfid_records WHERE kind = ? AND id = ?', row.kind, row.id);
    }
  }
}
