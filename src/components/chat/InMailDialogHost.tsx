// Mount raz w drzewie (np. __root.tsx); nasłuchuje bus'a i renderuje dialog.
import { useEffect, useState } from "react";
import { InMailDialog } from "./InMailDialog";
import { subscribeInMailDialog, type InMailPrefill } from "@/lib/chat/inmailDialogBus";
import { ensureI18n as ensureInmailI18n } from "@/lib/i18n-inmail";

export function InMailDialogHost() {
  ensureInmailI18n();
  const [prefill, setPrefill] = useState<InMailPrefill | null>(null);
  useEffect(() => subscribeInMailDialog(setPrefill), []);
  return (
    <InMailDialog
      open={prefill !== null}
      onOpenChange={(v) => {
        if (!v) setPrefill(null);
      }}
      prefill={prefill}
    />
  );
}
