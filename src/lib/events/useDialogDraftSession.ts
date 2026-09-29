import { useEffect, useRef } from "react";

/** Background refetches must not replace the user's unsaved draft. */
export function useDialogDraftSession(open: boolean, recordKey: string, initialize: () => void) {
  const session = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      session.current = null;
      return;
    }
    if (session.current === recordKey) return;
    session.current = recordKey;
    initialize();
  }, [open, recordKey, initialize]);
}
