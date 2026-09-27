// Molekuła: lista „Rzecz: N" dla liczników klonu edycji (skopiowane,
// pominięte, nieprzenoszone).
//
// KSZTAŁT „Rzecz: N", A NIE ZDANIE Z ODMIANĄ. Kilkadziesiąt rodzajów wierszy
// razy cztery polskie formy liczby to kilkaset zdań, które nic nie dodają do
// informacji. Rzeczownik z liczbą czyta się tak samo szybko w obu językach.
//
// PUSTA LISTA MÓWI „brak", A NIE ZNIKA. Nagłówek bez treści wygląda jak
// niedoczytany ekran; słowo „brak" jest odpowiedzią.
import { useTranslation } from "react-i18next";
import type { CloneItemEntry } from "@/lib/events/eventCloneLabels";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

export function EventCloneItemList({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: readonly CloneItemEntry[];
  emptyLabel: string;
}) {
  ensureCloneI18n();
  const { t } = useTranslation();
  return (
    <section className="space-y-1">
      <p className="text-xs font-semibold">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          {entries.map((entry) => (
            <li key={entry.id} className="tabular-nums">
              {t("adminEventClone.count", { label: t(entry.labelKey), count: entry.count })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
