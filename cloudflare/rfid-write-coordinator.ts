import { DurableObject } from "cloudflare:workers";
import { applyRfidCommand, emptyRfidLedger, type RfidCommand, type RfidLedger } from "../lib/rfid-ledger";

/** Serializes EPC and TID reservations across the small number of operator
 * encoder stations. One coordination atom is intentional because uniqueness
 * spans both identifiers and cannot be safely split across objects. */
export class RfidWriteCoordinator extends DurableObject<CloudflareEnv> {
  async command(input: { command: RfidCommand; operatorId: string; now?: number; id?: string }) {
    return this.ctx.storage.transaction(async (transaction) => {
      const ledger = await transaction.get<RfidLedger>("ledger") ?? emptyRfidLedger();
      const result = applyRfidCommand(ledger, input.command, input.operatorId, input.now ?? Date.now(), input.id);
      await transaction.put("ledger", ledger);
      return result;
    });
  }

  async snapshot(): Promise<RfidLedger> {
    return await this.ctx.storage.get<RfidLedger>("ledger") ?? emptyRfidLedger();
  }
}
