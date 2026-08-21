// Molekuła: JEDNA oś słownika bazy - etykieta i pełny zbiór jej wartości.
//
// CO BYŁO W ORGANIZMIE. Dwadzieścia dwa wywołania lokalnego `VocabRow`
// w `ClubElementsCatalog`, każde z etykietą, zbiorem i prefiksem tłumaczeń.
//
// REGUŁA, KTÓRA TU NIE MIESZKA (i dlaczego). Dopasowanie filtra jest
// w `visibleVocabValues` - moduł czysty, bo to reguła operacyjna: trafienie
// w ETYKIETĘ OSI zostawia CAŁĄ oś (kto wpisał „moderacja”, chce zobaczyć
// wszystkie tryby moderacji, nie tylko ten ze słowem „moderacja” w nazwie).
// Tutaj zostaje wyłącznie decyzja układowa: wiersz bez ANI JEDNEJ widocznej
// wartości nie renderuje pustej linii z etykietą - byłaby to obietnica zbioru,
// którego pod tym filtrem nie ma.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jedną oś. Tłumaczenie wartości robi tu,
// bo prefiks klucza dostaje z zewnątrz - słowniki tego katalogu mieszkają
// w TRZECH różnych przestrzeniach i18n (`club.*`, `adminClubs.*`,
// `clubElements.*`).
import { useTranslation } from "react-i18next";
import { ClubInboxCatalogValueChip } from "@/components/admin/clubs/molecules/ClubInboxCatalogValueChip";
import { visibleVocabValues } from "@/lib/clubs/adminElementsCatalog";

export function ClubInboxCatalogVocabRow({
  label,
  values,
  prefix,
  query,
}: {
  label: string;
  values: readonly string[];
  prefix: string;
  /** Szukanie JUŻ znormalizowane (`catalogQuery`); `""` = bez filtra. */
  query: string;
}) {
  const { t } = useTranslation();
  const rows = values.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
  const visible = visibleVocabValues(label, rows, query);

  if (visible.length === 0) return null;

  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-baseline">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((row) => (
          <ClubInboxCatalogValueChip key={row.value} value={row.value} label={row.label} />
        ))}
      </div>
    </div>
  );
}
