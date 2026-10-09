// OKNO WYKRESU - natywny `<dialog>` otwierany `showModal()`.
//
// DLACZEGO NATYWNY, a nie Radix. Okna wykresu (definicja wskaźnika, przypis,
// „Jak czytać", powiększenie) siedzą w silniku, który jedzie do budżetu
// CZYTELNIKA na każdej stronie z wykresem. Natywny dialog daje za darmo to,
// czego wymaga dostępność: warstwę wierzchnią, pułapkę fokusu, zamknięcie
// Escape'em i powrót fokusu do wywołującego - bez kilobajta biblioteki.
//
// Środowisko bez `showModal` (starszy silnik, happy-dom) dostaje atrybut
// `open`: okno jest wtedy zwykłym blokiem w treści, ale treść i przycisk
// zamknięcia działają.
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ChartDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  size?: "normal" | "wide";
  children: ReactNode;
}

export function ChartDialog({
  open,
  onClose,
  title,
  closeLabel,
  size = "normal",
  children,
}: ChartDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="neh-dialog"
      data-size={size}
      aria-labelledby={titleId}
      // `close` przychodzi także z Escape'a i z `dialog.close()` - stan Reacta
      // musi pójść za nim, inaczej następne otwarcie nie zadziała.
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Kliknięcie w tło (poza pudełkiem okna) zamyka - celem zdarzenia jest
      // wtedy sam `<dialog>`, a nie jego treść.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="neh-dialog-head">
            <div id={titleId} className="neh-dialog-title">
              {title}
            </div>
            <button
              type="button"
              className="neh-btn"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={onClose}
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
