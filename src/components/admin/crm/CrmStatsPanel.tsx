// STATYSTYKI CRM na zakładce-matce (/admin/crm).
//
// PO CO TU JEST. Zakładka Kontaktów była listą i tylko listą: dawała odpowiedź
// na "pokaż mi ten rekord", ale nie na "jak nam idzie". Lejek etapów, źródła
// pozyskania i zaległe zadania dało się odczytać dopiero po ręcznym filtrowaniu
// listy po kolei po każdym etapie. Sąsiednia strona „Lejek" nie wypełniała tej
// luki - ona jest lejkiem MARKETINGOWYM (subskrybenci newslettera), a nie
// lejkiem sprzedaży.
//
// DLACZEGO ZWINIĘTY DOMYŚLNIE. Ta strona jest NARZĘDZIEM PRACY: ludzie wchodzą
// tu wyszukać kontakt, a nie oglądać wykresy. Panel rozwinięty na sztywno
// spychałby listę i wyszukiwarkę pod krawędź ekranu i codzienna czynność
// kosztowałaby jedno przewinięcie więcej - za każdym razem, dla wszystkich.
// `<details>` daje zwijanie bez stanu, bez biblioteki i z obsługą klawiatury
// oraz wyszukiwarką przeglądarki w standardzie.
//
// NIE POBIERA DANYCH, DOPÓKI NIE ZOSTANIE OTWARTY - patrz `open` niżej. Inaczej
// każde wejście na listę kontaktów płaciłoby za agregat po całej tabeli.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import "@/lib/i18n-admin-dashboard";
import { DashboardPeriodTabs } from "@/components/admin/dashboard/DashboardPeriodTabs";
import { DashboardSection } from "@/components/admin/dashboard/DashboardSection";
import { CrmPanel } from "@/components/admin/dashboard/CrmPanel";
import { useCrmQuery, useDashboardRange } from "@/components/admin/dashboard/useDashboardData";
import type { DashboardPeriodId } from "@/lib/admin/dashboard/period";

export function CrmStatsPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriodId>("month");

  return (
    <details
      className="group rounded-xl border bg-card text-card-foreground shadow"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 text-sm font-semibold">
        <ChevronDown
          className="w-4 h-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        {t("adminDashboard.crm.title")}
        <span className="font-normal text-[11px] text-muted-foreground">
          {t("adminDashboard.crm.subtitle")}
        </span>
      </summary>
      <div className="px-3 pb-3 space-y-3">
        {/* Zapytanie rusza dopiero po otwarciu. */}
        {open ? <CrmStatsBody period={period} onPeriodChange={setPeriod} /> : null}
      </div>
    </details>
  );
}

function CrmStatsBody({
  period,
  onPeriodChange,
}: {
  period: DashboardPeriodId;
  onPeriodChange: (next: DashboardPeriodId) => void;
}) {
  const range = useDashboardRange(period);
  const crm = useCrmQuery(range);

  return (
    <>
      <DashboardPeriodTabs value={period} onChange={onPeriodChange} />
      <DashboardSection
        isPending={crm.isPending}
        isError={crm.isError}
        onRetry={() => void crm.refetch()}
        unavailable={crm.data?.available === false}
      >
        {crm.data ? <CrmPanel report={crm.data.report} range={range} /> : null}
      </DashboardSection>
    </>
  );
}
