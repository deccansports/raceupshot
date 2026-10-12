"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function DashboardChart({ data }: { data: Array<{ month: string; participants: number }> }) {
  return (
    <div style={{ width: "100%", height: 245 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
          <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1b6cff" stopOpacity=".3" /><stop offset="100%" stopColor="#1b6cff" stopOpacity="0" /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#e9edf2" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#788697", fontSize: 9 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#788697", fontSize: 9 }} />
          <Tooltip contentStyle={{ border: "1px solid #dce2e8", borderRadius: 6, fontSize: 11 }} />
          <Area type="monotone" dataKey="participants" stroke="#1b6cff" strokeWidth={2} fill="url(#chart-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
