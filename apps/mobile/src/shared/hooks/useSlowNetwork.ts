import { useEffect, useState } from "react";

export function useSlowNetwork(pending: boolean, delayMs = 3_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(pending), pending ? delayMs : 0);
    return () => clearTimeout(timer);
  }, [delayMs, pending]);
  return pending && slow;
}
