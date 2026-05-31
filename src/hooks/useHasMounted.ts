import { useEffect, useState } from "react";

/** Returns true after the component has mounted on the client. Prevents SSR hydration mismatches for auth/theme-aware UI. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
