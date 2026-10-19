// Molekuła: sekcja zakładki huba - nagłówek `h2`, opcjonalny opis i akcje,
// treść w ramce `rounded-[6px] border` (SPEC §6.1, UX §13-§14).
//
// JEDNA SEKCJA DLA WSZYSTKICH ZAKŁADEK. Hierarchia nagłówków huba jest stała:
// `h1` = nazwa huba (układ), `h2` = sekcja zakładki, `h3` = karta w sekcji.
// Sekcja składana ręcznie w każdej zakładce prędzej czy później dostałaby
// `h3` pod `h1` albo inną ramkę w trybie ciemnym - tu ustala się to raz.
//
// `aria-labelledby` NA NAGŁÓWEK: sekcja jest regionem z nazwą, więc czytnik
// pozwala przeskakiwać między sekcjami zakładki jak między rozdziałami.
// Napisy przez klucze (`titleKey`), bo sekcje są budowane z mapy zakładek
// S7, a klucz w danych jest stabilniejszy od gotowego napisu.
//
// Ramka `rounded-[6px]` to promień panelu (`.admin-compact`), identyczny
// w obu motywach - motyw zmienia tylko kolory tokenów.
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

export interface RevenueSectionProps {
  titleKey: string;
  descriptionKey?: string;
  /** Przyciski sekcji (odśwież, eksport, „Otwórz moduł"). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RevenueSection({
  titleKey,
  descriptionKey,
  actions,
  children,
  className,
}: RevenueSectionProps) {
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-[6px] border border-border bg-card p-4 space-y-3", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h2 id={headingId} className="text-base font-semibold">
            {t(titleKey)}
          </h2>
          {descriptionKey ? (
            <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
