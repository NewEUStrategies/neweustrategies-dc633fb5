// Molekuła: lista wierszy „klucz + etykieta PL + etykieta EN + liczba" -
// formy wystąpień (liczba = minuty) i kryteria oceny (liczba = waga).
//
// JEDEN EDYTOR DLA DWÓCH LIST, bo obie mają ten sam kształt i te same reguły
// (klucz techniczny, dwie etykiety, liczba z zakresu). Dwa edytory rozjeżdżałyby
// się przy pierwszej poprawce układu.
//
// KLUCZ PODPOWIADAMY Z ETYKIETY PL, dopóki wiersz jest nowy i klucz pusty -
// organizator opisuje formę, nie schemat bazy. Klucz zapisanego wiersza zostaje,
// bo odwołują się do niego zgłoszenia (`format_key`) i oceny (`scores`).
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";
import { suggestCfpKey } from "@/lib/events/cfpSettingsDraft";

export interface CfpLabelledRow {
  key: string;
  labelPl: string;
  labelEn: string;
  value: string;
}

export function CfpLabelledListEditor({
  idPrefix,
  rows,
  onChange,
  valueLabel,
  addLabel,
  emptyLabel,
  newRow,
  max,
  error,
}: {
  idPrefix: string;
  rows: readonly CfpLabelledRow[];
  onChange: (rows: CfpLabelledRow[]) => void;
  valueLabel: string;
  addLabel: string;
  emptyLabel: string;
  newRow: () => CfpLabelledRow;
  max: number;
  error: string | null;
}) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<CfpLabelledRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        rows.map((row, index) => (
          <fieldset
            key={`${idPrefix}-${index}`}
            className="grid gap-2 rounded-[6px] border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_7rem_auto]"
          >
            <legend className="sr-only">{t("adminEventCfp.list.rowLegend", { index: index + 1 })}</legend>
            <AdminFormTextRow
              id={`${idPrefix}-${index}-pl`}
              label={t("adminEventCfp.list.labelPl")}
              value={row.labelPl}
              maxLength={80}
              onValueChange={(labelPl) =>
                update(
                  index,
                  row.key === "" || row.key === suggestCfpKey(row.labelPl)
                    ? { labelPl, key: suggestCfpKey(labelPl) }
                    : { labelPl },
                )
              }
            />
            <AdminFormTextRow
              id={`${idPrefix}-${index}-en`}
              label={t("adminEventCfp.list.labelEn")}
              value={row.labelEn}
              maxLength={80}
              onValueChange={(labelEn) => update(index, { labelEn })}
            />
            <AdminFormTextRow
              id={`${idPrefix}-${index}-key`}
              label={t("adminEventCfp.list.key")}
              value={row.key}
              monospace
              maxLength={49}
              onValueChange={(key) => update(index, { key })}
            />
            <AdminFormTextRow
              id={`${idPrefix}-${index}-value`}
              label={valueLabel}
              value={row.value}
              inputMode="numeric"
              onValueChange={(value) => update(index, { value })}
            />
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                {t("adminEventCfp.list.remove")}
              </Button>
            </div>
          </fieldset>
        ))
      )}
      {error === null ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rows.length >= max}
        onClick={() => onChange([...rows, newRow()])}
      >
        {addLabel}
      </Button>
    </div>
  );
}
