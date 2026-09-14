// Mount raz w drzewie (np. __root.tsx); nasłuchuje bus'a i renderuje dialog.
import { lazy, Suspense, useEffect, useState } from "react";
const ExpertRequestDialog = lazy(() =>
  import("./ExpertRequestDialog").then((m) => ({ default: m.ExpertRequestDialog })),
);
import {
  subscribeExpertRequestDialog,
  type ExpertRequestPrefill,
} from "@/lib/chat/expertRequestDialogBus";

export function ExpertRequestDialogHost() {
  const [prefill, setPrefill] = useState<ExpertRequestPrefill | null>(null);
  useEffect(() => subscribeExpertRequestDialog(setPrefill), []);
  if (!prefill) return null;
  return (
    <Suspense fallback={null}>
      <ExpertRequestDialog
        open={prefill !== null}
        onOpenChange={(v) => {
          if (!v) setPrefill(null);
        }}
        prefill={prefill}
      />
    </Suspense>
  );
}
