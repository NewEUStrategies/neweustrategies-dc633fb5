// Atom: SEGMENT PRZYCHODU warstwy - tylko do odczytu, z dymkiem.
//
// Segment nie jest polem formularza: liczy go baza z klucza warstwy
// (`revenue_segment_of_tier`, lustro `REVENUE_SEGMENT_BY_TIER`) i zapisuje
// w każdym ruchu księgi MRR. Admin, który zmienia rangę albo flagi, ma jednak
// widzieć, w którym segmencie hub raportuje tę warstwę (decyzja właściciela
// 2026-10-20: segment wynika z typu klienta - organizacja, osoba po cenie
// katalogowej, osoba w stawce ulgowej, reszta). Bez chipa przeniesienie
// partnerów i NGO do instytucji byłoby widoczne tylko w SQL.
//
// Dymek to wspólny `HintTooltip` (cel 24 px, opis w DOM dla czytnika), więc
// geometria jest ta sama w trybie jasnym i ciemnym - zmieniają się tylko kolory
// z tokenów motywu. `hint={false}` tam, gdzie chip siedzi WEWNĄTRZ przycisku
// (kafel katalogu): drugi przycisk w przycisku łamałby dostępność.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";
import { revenueSegmentOfTier, type RevenueDataSegment } from "@/lib/revenue/segments";

/** Literały kluczy (bez szablonu) - bramki i18n widzą każdy klucz w kodzie. */
const SEGMENT_LABEL_KEY: Readonly<Record<RevenueDataSegment, string>> = {
  b2c_individual: "adminMembership.revenueSegment.values.b2c_individual",
  b2c_reduced: "adminMembership.revenueSegment.values.b2c_reduced",
  b2b_institution: "adminMembership.revenueSegment.values.b2b_institution",
  other: "adminMembership.revenueSegment.values.other",
};

export function RevenueSegmentChip({ tierKey, hint = true }: { tierKey: string; hint?: boolean }) {
  // Słownik członkostwa rejestruje się w chunku komponentu (jak edytor puli
  // zapytań) - chip działa także poza workspace'em członkostwa.
  ensureAdminMembershipI18n();
  const { t } = useTranslation();
  const hintId = useId();
  const segment = revenueSegmentOfTier(tierKey);
  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        className="rounded-[6px] border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        data-revenue-segment={segment}
        aria-describedby={hint ? hintId : undefined}
      >
        {t("adminMembership.revenueSegment.label")}: {t(SEGMENT_LABEL_KEY[segment])}
      </span>
      {hint ? (
        <HintTooltip
          id={hintId}
          text={t("adminMembership.revenueSegment.hint")}
          label={t("adminMembership.revenueSegment.hintLabel")}
        />
      ) : null}
    </span>
  );
}
