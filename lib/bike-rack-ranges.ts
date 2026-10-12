export interface BikeRackRange { id: string; rackName: string; bibFrom: number; bibTo: number }

export function validateBikeRackRanges(ranges: BikeRackRange[]): BikeRackRange[] {
  if (ranges.length > 200) throw new Error("Use no more than 200 rack ranges per event.");
  const normalized = ranges.map((range, index) => {
    const rackName = range.rackName.trim();
    if (!rackName || rackName.length > 80) throw new Error(`Rack ${index + 1}: enter a rack name up to 80 characters.`);
    if (!Number.isSafeInteger(range.bibFrom) || !Number.isSafeInteger(range.bibTo) || range.bibFrom < 1 || range.bibTo < range.bibFrom) {
      throw new Error(`Rack ${rackName}: enter a valid positive BIB range.`);
    }
    return { id: range.id || crypto.randomUUID(), rackName, bibFrom: range.bibFrom, bibTo: range.bibTo };
  }).sort((a, b) => a.bibFrom - b.bibFrom || a.bibTo - b.bibTo);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].bibFrom <= normalized[index - 1].bibTo) {
      throw new Error(`BIB ranges overlap: ${normalized[index - 1].rackName} and ${normalized[index].rackName}.`);
    }
  }
  return normalized;
}

export function assignedBikeRack(bib: string, ranges: BikeRackRange[]): string | null {
  if (!/^\d+$/.test(bib.trim())) return null;
  const number = Number(bib.trim());
  if (!Number.isSafeInteger(number)) return null;
  return ranges.find((range) => number >= range.bibFrom && number <= range.bibTo)?.rackName ?? null;
}
