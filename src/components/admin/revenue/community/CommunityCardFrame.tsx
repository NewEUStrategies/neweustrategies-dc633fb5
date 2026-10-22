// Molekuła: rama karty zakładki „Społeczność" - nagłówek `h3`, podpis,
// akcje i jeden z dwóch stanów: dane albo stan karty.
//
// Odmowa roli, brak funkcji w bazie (migracja w drodze), brak najemcy, MFA
// i błąd to STANY KARTY ze zdaniami słownika społeczności S4
// (`adminRevenue.community.state.*`), nie toasty (SPEC §2.5). Trzy karty
// zakładki składane ręcznie rozjechałyby się w geometrii ramki albo
// w kolejności sprawdzeń - stąd jedna rama, jak `FinanceCardFrame`
// zakładek finansowych.
//
// GEOMETRIA JEDNA W OBU MOTYWACH: `rounded-[6px] border p-3` jak karty
// Lejka, Dostępu i Przychodu - motyw zmienia tylko kolory tokenów.
import { useId, type ReactNode } from "react";

import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import type { HubCardStatus } from "@/components/admin/revenue/overview/hubWindow";

export interface CommunityCardFrameProps {
  testId: string;
  title: string;
  subtitle?: string;
  status: HubCardStatus | "ready";
  onRetry?: () => void;
  actions?: ReactNode;
  /** Treść rysowana wyłącznie w stanie `ready`. */
  children?: ReactNode;
}

export function CommunityCardFrame({
  testId,
  title,
  subtitle,
  status,
  onRetry,
  actions,
  children,
}: CommunityCardFrameProps) {
  const headingId = useId();
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
          forbiddenKey="adminRevenue.community.state.forbidden"
          unavailableKey="adminRevenue.community.state.unavailable"
          onRetry={onRetry}
        />
      )}
    </section>
  );
}

/**
 * Para „etykieta - wartość" z definicją pola pod spodem (lista `dl`).
 * Definicja jest widoczna, nie w dymku: to zdanie słownika S4, które mówi
 * dokładnie to samo co agregat SQL (np. że no-show liczy się dopiero po
 * zakończeniu wydarzenia) - bez niego liczba bywa czytana źle.
 */
export function CommunityStat({
  label,
  hint,
  value,
  stat,
}: {
  label: string;
  hint: string;
  value: ReactNode;
  stat: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5" data-stat={stat}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 space-y-0.5">
        <span className="block text-base font-semibold tabular-nums">{value}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </dd>
    </div>
  );
}
