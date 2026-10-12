import { cn, eventStatusLabel } from "@/lib/utils";

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("status-pill", `status-${status}`)}>
      {status === "live" && <span className="pulse-dot" />}
      {eventStatusLabel(status)}
    </span>
  );
}
