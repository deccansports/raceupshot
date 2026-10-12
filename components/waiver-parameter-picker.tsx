"use client";

import { waiverTemplateParameterGroups } from "@/lib/waiver-template";

export function WaiverParameterPicker({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="waiver-parameter-picker">
      <div className="waiver-parameter-heading">
        <b>Optional waiver parameters</b>
        <small>Click a parameter to insert it in bold at the end of the waiver template.</small>
      </div>
      <div className="waiver-parameter-groups">
        {waiverTemplateParameterGroups.map((group) => (
          <div className="waiver-parameter-group" key={group.label}>
            <span>{group.label}</span>
            <div>
              {group.parameters.map((parameter) => (
                <button
                  type="button"
                  key={parameter.token}
                  title={parameter.token}
                  onClick={() => onInsert(parameter.token)}
                >
                  {parameter.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <small className="waiver-parameter-help">Both <code>{"{{params.name}}"}</code> and pasted aliases such as <code>{"{{name}}"}</code>, <code>{"{{eventname}}"}</code>, <code>{"{{category}}"}</code>, <code>{"{{phone}}"}</code> and <code>{"{{emergency_number}}"}</code> are supported.</small>
    </div>
  );
}
