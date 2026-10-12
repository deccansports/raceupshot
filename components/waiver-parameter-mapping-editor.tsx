"use client";

import { WaiverParameterMapping, inferredWaiverParameterSource, waiverParameterSources, waiverTemplateMappingTokens } from "@/lib/waiver-template";

export function WaiverParameterMappingEditor({
  template,
  mappings,
  onChange,
}: {
  template: string;
  mappings: WaiverParameterMapping[];
  onChange: (mappings: WaiverParameterMapping[]) => void;
}) {
  const tokens = waiverTemplateMappingTokens(template);
  const update = (token: string, patch: Partial<WaiverParameterMapping>) => {
    const existing = mappings.find((mapping) => mapping.token.toLowerCase() === token.toLowerCase());
    const next = { token, source: "custom" as const, ...existing, ...patch };
    onChange([...mappings.filter((mapping) => mapping.token.toLowerCase() !== token.toLowerCase()), next]);
  };
  return (
    <div className="waiver-parameter-mappings">
      <p className="field-hint">All standard parameters are listed below. Mappings are saved only on this event; only placeholders used in the waiver are rendered. Unmapped placeholders keep their standard behavior.</p>
      {tokens.map((token) => {
        const mapping = mappings.find((item) => item.token.toLowerCase() === token.toLowerCase());
        const source = mapping?.source ?? inferredWaiverParameterSource(token);
        return (
          <div className="waiver-parameter-mapping" key={token}>
            <code>{"{{"}{token}{"}}"}</code>
            <select aria-label={"Map " + token} value={source} onChange={(event) => update(token, { source: event.target.value as WaiverParameterMapping["source"], customValue: "" })}>
              {waiverParameterSources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {source === "custom" && <input aria-label={"Custom value for " + token} value={mapping?.customValue ?? ""} placeholder="Value used for this event" onChange={(event) => update(token, { source: "custom", customValue: event.target.value })} />}
          </div>
        );
      })}
    </div>
  );
}
