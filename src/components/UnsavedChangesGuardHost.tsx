// Host component: renders the styled leave-confirmation dialog whenever the
// unsaved-changes store has a pending prompt. Mounted once in __root.tsx.
//
// HOST JEST PUSTY DO CZASU PYTANIA (wzorzec `LoginPopupHost`). Wisi w korzeniu
// na KAŻDEJ stronie, także publicznej, a okno potwierdzenia jest zdarzeniem
// wyłącznie edytorskim. Statyczny import `alert-dialog` ciągnął tu Radiksa do
// bundla startowego każdej strony - dlatego samo okno jedzie przez
// `React.lazy` i montuje się dopiero, gdy blokada nawigacji o coś pyta.
// SSR i pierwszy render klienta zwracają `null`, więc parytet hydratacji jest
// strukturalny.
import { lazy, Suspense, useEffect, useState } from "react";
import { subscribeLeaveConfirmation } from "@/lib/unsavedChanges";

const UnsavedChangesGuardDialog = lazy(() =>
  import("./UnsavedChangesGuardDialog").then((m) => ({
    default: m.UnsavedChangesGuardDialog,
  })),
);

export function UnsavedChangesGuardHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeLeaveConfirmation((p) => setOpen(p !== null)), []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <UnsavedChangesGuardDialog />
    </Suspense>
  );
}
