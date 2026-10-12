import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function eventStatusLabel(status: string) {
  return {
    live: "Live now",
    upcoming: "Upcoming",
    official: "Official results",
    provisional: "Provisional",
  }[status] ?? status;
}
