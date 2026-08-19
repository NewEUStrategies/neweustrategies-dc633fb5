// Atom komunikatu podglądu pliku.
//
// Trzy warianty (zajętość / błąd / pusty dokument) żyły dotąd jako trzy
// prywatne komponenty wewnątrz 415-liniowego `DocumentViewerBody.tsx`,
// powielone w czterech czytnikach. Tutaj są jednym atomem sterowanym
// DESKRYPTOREM z `lib/files/viewerState` - komponent nie podejmuje już żadnej
// decyzji, tylko rysuje to, co reguła zwróciła.
//
// Klucze i18n przychodzą w deskryptorze, więc atom nie zna ani jednego napisu.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ViewerPanel } from "@/lib/files/viewerState";

/** Ramka komunikatu - wspólna wysokość i wyrównanie dla wszystkich czytników. */
export function ViewerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Komunikat dla stanu innego niż „gotowe do pokazania". */
export function ViewerNotice({ panel }: { panel: Exclude<ViewerPanel, { kind: "ready" }> }) {
  const { t } = useTranslation();

  if (panel.kind === "busy") {
    return (
      <ViewerFrame>
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <span>{t(panel.labelKey)}</span>
      </ViewerFrame>
    );
  }

  if (panel.kind === "empty") {
    return <ViewerFrame>{t(panel.labelKey)}</ViewerFrame>;
  }

  return (
    <ViewerFrame>
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <span className="font-medium text-foreground">{t(panel.labelKey)}</span>
      {panel.hintKey !== null ? <span className="max-w-sm text-xs">{t(panel.hintKey)}</span> : null}
    </ViewerFrame>
  );
}
