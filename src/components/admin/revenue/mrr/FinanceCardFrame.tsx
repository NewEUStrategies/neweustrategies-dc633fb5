// Molekuła: rama karty finansowej zakładek Przychód i Retencja (S7-C) -
// nagłówek `h3`, opcjonalny podpis i akcje, a w treści jeden z trzech
// stanów: kafel zablokowany, stan karty albo dane.
//
// PO CO WSPÓLNA RAMA. Dziesięć kart dwóch zakładek ma te same trzy decyzje:
//   * rola bez kwot (redaktor) → `LockedMetricTile` w miejscu karty i BEZ
//     wywołania RPC finansowego (karta przekazuje bramkę `roleOk` do fabryki
//     zapytania, rama tylko rysuje skutek);
//   * odmowa, brak funkcji w bazie, MFA, brak najemcy, błąd → `HubCardState`
//     ze zdaniami słownika finansów (stany kart, nie toasty - SPEC §2.5);
//   * dane → treść karty.
// Karta składana ręcznie dziesięć razy rozjechałaby się w geometrii ramki
// albo w kolejności tych sprawdzeń (np. odczyt przed bramką roli).
//
// GEOMETRIA JEDNA W OBU MOTYWACH: ramka `rounded-[6px] border p-3` jak karty
// Lejka i Dostępu (S7-B) - motyw zmienia tylko kolory tokenów.
import { useId, type ReactNode } from "react";

import { LockedMetricTile } from "@/components/admin/revenue/atoms/LockedMetricTile";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import type { HubCardStatus } from "@/components/admin/revenue/overview/hubWindow";

export interface FinanceCardFrameProps {
  testId: string;
  title: string;
  subtitle?: string;
  /** Dokładna rola `admin` sesji - bez niej kafel zablokowany, bez treści. */
  isAdmin: boolean;
  status: HubCardStatus | "ready";
  onRetry?: () => void;
  actions?: ReactNode;
  /** Treść rysowana wyłącznie w stanie `ready`. */
  children?: ReactNode;
}

export function FinanceCardFrame({
  testId,
  title,
  subtitle,
  isAdmin,
  status,
  onRetry,
  actions,
  children,
}: FinanceCardFrameProps) {
  const headingId = useId();

  if (!isAdmin) {
    return (
      <div data-testid={testId} data-locked="admin_only">
        <LockedMetricTile label={title} reason="admin_only" />
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      data-card-status={status}
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {title}
          </h3>
          {subtitle ? <p className="m-0 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {status === "ready" ? (
        children
      ) : (
        <HubCardState
          status={status}
          forbiddenKey="adminRevenue.finance.state.forbidden"
          unavailableKey="adminRevenue.finance.state.unavailable"
          onRetry={onRetry}
        />
      )}
    </section>
  );
}

/**
 * Brak liczby w komórce: kreska dla oka i „brak danych" dla czytnika.
 * Zdanie DLACZEGO (`adminRevenue.finance.noDataHint`) stoi raz pod tabelą
 * (`NoValueFootnote`), a nie w każdej komórce.
 */
export function NoValue({ label }: { label: string }) {
  return (
    <span data-value="none">
      <span aria-hidden="true">-</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Przypis pod tabelą z kreskami: kreska to nie zero, tylko liczba nie do policzenia. */
export function NoValueFootnote({ label, hint }: { label: string; hint: string }) {
  return (
    <p className="m-0 text-xs text-muted-foreground" data-testid="no-value-footnote">
      <span aria-hidden="true">- </span>
      {label}: {hint}
    </p>
  );
}
