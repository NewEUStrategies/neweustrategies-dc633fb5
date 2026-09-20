// Host for the shared confirm/prompt dialogs (lib/appDialogs.ts). Mounted
// once in __root.tsx - callers anywhere in the tree just await
// confirmDialog()/promptDialog() instead of window.confirm()/window.prompt().
//
// HOST JEST PUSTY DO CZASU ZGŁOSZENIA (wzorzec `LoginPopupHost`). Wisi w
// korzeniu na KAŻDEJ stronie, także publicznej, a okno jest zdarzeniem
// rzadkim i niemal wyłącznie administracyjnym. Statyczny import Radiksa
// (`dialog` + `alert-dialog`) ciągnął `vendor-radix` do bundla startowego
// każdej strony - dlatego ciało okna jedzie przez `React.lazy` i montuje się
// dopiero przy oczekującym zgłoszeniu. SSR i pierwszy render klienta zwracają
// `null`, więc parytet hydratacji jest strukturalny.
import { lazy, Suspense, useEffect, useState } from "react";
import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";

const AppDialogView = lazy(() =>
  import("./AppDialogView").then((m) => ({ default: m.AppDialogView })),
);

export function AppDialogHost() {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  // Wartość pola zostaje TU, a nie w leniwym widoku: zasiewa ją zgłoszenie
  // (`defaultValue`) w chwili nadejścia, jeszcze zanim moduł okna dojedzie.
  const [value, setValue] = useState("");

  useEffect(
    () =>
      subscribeAppDialog((p) => {
        setPending(p);
        if (p?.request.kind === "prompt") setValue(p.request.defaultValue ?? "");
      }),
    [],
  );

  if (!pending) return null;
  return (
    <Suspense fallback={null}>
      <AppDialogView pending={pending} value={value} onValueChange={setValue} />
    </Suspense>
  );
}
