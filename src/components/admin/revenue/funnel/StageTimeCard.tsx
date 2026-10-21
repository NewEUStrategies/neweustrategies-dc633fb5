// Organizm: czas między krokami lejka (SPEC §6.1 `StageTimeCard`).
//
// „BRAK DANYCH" Z POWODEM, NIE ZERO. Agregat lejka (`_funnel_counts`, S3)
// liczy kroki w oknie, ale nie zapisuje chwili przejścia konta z kroku do
// kroku - czasu nie ma z czego policzyć. Karta stoi na mapie, żeby admin
// wiedział, że ta liczba nie istnieje (i dlaczego), zamiast szukać jej
// gdzie indziej albo czytać pustkę jako „natychmiast". Źródło czasu przejść
// to zgłoszenie dla producenta lejka, nie wymyślona liczba po stronie panelu.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function StageTimeCard() {
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="stage-time"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {t("adminRevenue.funnelTab.stageTime.title")}
      </h3>
      <p role="status" data-card-state="no_source" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.funnelTab.stageTime.noSource")}
      </p>
    </section>
  );
}
