// Atrapy UI dla testow ekranu "Lejek Google Ads".
//
// Radix Dialog nie ma pod happy-dom portalu ani pelnej mechaniki fokusa,
// a Radix Select nie rozwija listy (brak pointer API) - konwencja repo to
// natywne odpowiedniki niosace TEN SAM kontrakt (patrz
// `EventPageCreateDialog.test.tsx`, `VerificationDomainsCard.test.tsx`).
// Uzycie w pliku testowym (vi.mock musi stac w pliku, zeby byl podniesiony):
//   vi.mock("@/components/ui/dialog", async () =>
//     (await import("@/test/events/adsFunnelStubs")).dialogModuleStub());
//   vi.mock("@/components/atoms/FormSelect", async () =>
//     (await import("@/test/events/adsFunnelStubs")).formSelectModuleStub());
import type { ReactNode } from "react";

export const DIALOG_CLOSE_LABEL = "atrapa-zamknij-okno";

export function dialogModuleStub(): Record<string, unknown> {
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) =>
      open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="atrapa-tytul-okna">
          <button
            type="button"
            aria-label={DIALOG_CLOSE_LABEL}
            onClick={() => onOpenChange?.(false)}
          />
          {children}
        </div>
      ) : null,
    DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => (
      <h2 id="atrapa-tytul-okna">{children}</h2>
    ),
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
}

export function formSelectModuleStub(): Record<string, unknown> {
  return {
    FormSelect: ({
      id,
      value,
      options,
      onValueChange,
      "aria-label": ariaLabel,
    }: {
      id?: string;
      value: string;
      options: readonly { value: string; label: ReactNode }[];
      onValueChange: (next: string) => void;
      "aria-label"?: string;
    }) => (
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
}
