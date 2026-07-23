// Mount raz w drzewie (np. __root.tsx); nasłuchuje bus'a i renderuje dialog.
import { useEffect, useState } from "react";
import { ExpertRequestDialog } from "./ExpertRequestDialog";
import {
  subscribeExpertRequestDialog,
  type ExpertRequestPrefill,
} from "@/lib/chat/expertRequestDialogBus";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";

export function ExpertRequestDialogHost() {
  ensureExpertRequestI18n();
  const [prefill, setPrefill] = useState<ExpertRequestPrefill | null>(null);
  useEffect(() => subscribeExpertRequestDialog(setPrefill), []);
  return (
    <ExpertRequestDialog
      open={prefill !== null}
      onOpenChange={(v) => {
        if (!v) setPrefill(null);
      }}
      prefill={prefill}
    />
  );
}
