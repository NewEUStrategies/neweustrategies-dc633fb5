// Molekuła: notka z dymkiem „starsze dni z agregatu dobowego" (I9d-Y1,
// Z-I9c-07) - zakładka Lejek huba, mini lejek Kokpitu i pulpit monetyzacji.
//
// DLACZEGO. Odczyty licznika (`metered_views`) żyją domyślnie 3 mies., a nie
// 13 jak uderzenia w paywall, więc granica odczytu lejka i pulpitu przesuwa
// się do okresu odczytów: dni sprzed niej liczy anonimowy agregat dobowy
// (konto raz na dzień, nie raz na okno - znana granica agregatu, §21.21
// pkt 4). Bez notki admin porównałby „konta aktywne" z okna 6 mies. sprzed
// i po wdrożeniu i uznał spadek za zjawisko rynkowe.
//
// DWA TRYBY, JEDNA TREŚĆ:
//   * `before` - pulpit monetyzacji zna DOKŁADNĄ granicę (`aggregate_before`
//     z RPC, dzień UTC): notka tylko, gdy okno zaczyna się przed nią;
//   * `windowStarts` - lejek huba i Kokpit (RPC S3 granicy nie zwraca, a odczyt
//     ustawień retencji wymaga roli administratora): notka, gdy okno sięga
//     dalej niż NAJKRÓTSZY dozwolony okres odczytów (2 mies.) - bliżej
//     agregat nigdy nie wchodzi, więc krótkie okna nie dostają szumu.
//
// Daty: `before` to dzień kalendarzowy (`formatDateOnly`, bez przesunięcia
// strefy); próg okna - lokalny konstruktor daty jak w `ProvenanceNote`.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { ensureI18n } from "@/lib/i18n-admin-retention-aggregate";
import { formatDateOnly } from "@/lib/i18n/format";
import { DATA_RETENTION_PERIODS } from "@/lib/privacy/dataRetention";
import { windowMayUseAggregate } from "./aggregateWindow";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface RetentionAggregateNoteProps {
  /** Pulpit: pierwszy dzień liczony z surowych wierszy (`YYYY-MM-DD`, UTC). */
  before?: string | null;
  /** Pulpit: pierwszy dzień okna (`YYYY-MM-DD`). */
  from?: string | null;
  /** Lejek: początki pokazywanych okien (ISO 8601) - bieżące i porównawcze. */
  windowStarts?: readonly (string | null | undefined)[];
  /** Zegar (testy). */
  now?: Date;
}

export function RetentionAggregateNote({
  before,
  from,
  windowStarts,
  now,
}: RetentionAggregateNoteProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const id = useId();

  let text: string | null = null;
  if (before !== undefined) {
    // Porównanie napisów `YYYY-MM-DD` = porównanie dni (bez strefy).
    if (before && from && DAY.test(before) && DAY.test(from) && from < before) {
      text = t("adminDataRetention.aggregateNote.before", {
        date: formatDateOnly(before, i18n.language),
      });
    }
  } else if (windowStarts && windowMayUseAggregate(windowStarts, now)) {
    text = t("adminDataRetention.aggregateNote.window", {
      months: DATA_RETENTION_PERIODS.metered_views.defaultMonths,
    });
  }
  if (text === null) return null;

  return (
    <p
      data-retention-aggregate=""
      className="flex flex-wrap items-center gap-1 text-[11px] leading-snug text-muted-foreground"
    >
      {t("adminDataRetention.aggregateNote.short")}
      <HintTooltip id={id} text={text} label={t("adminDataRetention.aggregateNote.label")} />
    </p>
  );
}
