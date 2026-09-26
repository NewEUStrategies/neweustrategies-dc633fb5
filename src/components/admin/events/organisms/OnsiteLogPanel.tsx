// Organizm: DZIENNIK ODPRAW.
//
// FILTRY IDĄ DO BAZY, NIE DO TABLICY W PRZEGLĄDARCE. Dziennik dużego wydarzenia
// to dziesiątki tysięcy wierszy - filtrowanie po stronie klienta wymagałoby
// najpierw ściągnięcia całości, czyli wysłania do przeglądarki danych, których
// operator nie ma prawa zobaczyć w komplecie.
//
// `total_count` PRZYCHODZI W WIERSZU. Baza zwraca łączną liczbę razem ze stroną,
// żeby paginacja nie potrzebowała drugiego zapytania - a przy pustej stronie
// liczba jest zerem i to jest prawda, nie brak danych.
//
// DZIENNIKA NIE EDYTUJEMY. Nie ma tu akcji zapisu ani usuwania: wiersz odprawy
// jest dowodem wpuszczenia i zmiana go po fakcie unieważniłaby audyt.
//
// DECYZJA BEZ SIECI JEST WIDOCZNA. Wiersz zapisany ze skanu offline ma
// plakietkę „offline" (z decyzją urządzenia w podpowiedzi), a gdy urządzenie
// wpuściło, a baza odmawia - czerwoną plakietkę „konflikt". Konflikt liczy
// baza (`admin_event_checkins_list.conflict`, według trybu punktu), a filtr
// „tylko konflikty" idzie do bazy jak pozostałe.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import { useCheckins, useCheckpoints } from "@/lib/events/useEventOnsite";
import { CHECKIN_DIRECTIONS, CHECKIN_RESULTS } from "@/lib/events/onsiteApi";
import type { OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isOfflineOutcome } from "@/lib/events/onsiteEnums";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLang } from "@/lib/i18n/format";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";

ensureOnsiteI18n();

const ALL = "__all__";

const OFFLINE_OUTCOME_KEY: Record<OfflineOutcome, string> = {
  granted: "adminEventOnsite.offlineOutcomes.granted",
  denied_direction: "adminEventOnsite.offlineOutcomes.denied_direction",
  denied_registration_status: "adminEventOnsite.offlineOutcomes.denied_registration_status",
  unknown_code: "adminEventOnsite.offlineOutcomes.unknown_code",
  repeat: "adminEventOnsite.offlineOutcomes.repeat",
};

export function OnsiteLogPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [checkpointId, setCheckpointId] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [result, setResult] = useState(ALL);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const checkpointsQ = useCheckpoints(eventId);
  const listQ = useCheckins({
    eventId,
    checkpointId: checkpointId === ALL ? undefined : checkpointId,
    direction: direction === ALL ? undefined : (direction as "in" | "out"),
    result: result === ALL ? undefined : result,
    q: debounced,
    conflictsOnly,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const rows = listQ.data ?? [];
  const total = rows.length === 0 ? 0 : rows[0].total_count;

  const checkpointOptions = useMemo(
    () => [
      { value: ALL, label: t("adminEventOnsite.filters.all") },
      ...(checkpointsQ.data ?? []).map((row) => ({
        value: row.id,
        label: lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en,
      })),
    ],
    [checkpointsQ.data, lang, t],
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.log.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.log.subtitle")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="log-checkpoint">{t("adminEventOnsite.filters.checkpoint")}</Label>
          <FormSelect
            id="log-checkpoint"
            value={checkpointId}
            options={checkpointOptions}
            onValueChange={(value) => {
              setCheckpointId(value);
              setPage(1);
            }}
            aria-label={t("adminEventOnsite.filters.checkpoint")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-direction">{t("adminEventOnsite.filters.direction")}</Label>
          <FormSelect
            id="log-direction"
            value={direction}
            options={[
              { value: ALL, label: t("adminEventOnsite.filters.all") },
              ...CHECKIN_DIRECTIONS.map((item) => ({
                value: item,
                label: t(`adminEventOnsite.directions.${item}`),
              })),
            ]}
            onValueChange={(value) => {
              setDirection(value);
              setPage(1);
            }}
            aria-label={t("adminEventOnsite.filters.direction")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-result">{t("adminEventOnsite.filters.result")}</Label>
          <FormSelect
            id="log-result"
            value={result}
            options={[
              { value: ALL, label: t("adminEventOnsite.filters.all") },
              ...CHECKIN_RESULTS.map((item) => ({
                value: item,
                label: t(`adminEventOnsite.results.${item}`),
              })),
            ]}
            onValueChange={(value) => {
              setResult(value);
              setPage(1);
            }}
            aria-label={t("adminEventOnsite.filters.result")}
          />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
          <Checkbox
            id="log-conflicts-only"
            checked={conflictsOnly}
            onCheckedChange={(next) => {
              setConflictsOnly(next === true);
              setPage(1);
            }}
          />
          <Label htmlFor="log-conflicts-only">{t("adminEventOnsite.filters.conflictsOnly")}</Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-search">{t("adminEventOnsite.filters.search")}</Label>
          <Input
            id="log-search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventOnsite.log.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={
          conflictsOnly
            ? t("adminEventOnsite.log.conflictsEmpty")
            : t("adminEventOnsite.log.empty")
        }
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <ul className="divide-y divide-border/70">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      lang === "en"
                        ? row.checkpoint_name_en || row.checkpoint_name_pl
                        : row.checkpoint_name_pl || row.checkpoint_name_en,
                      row.device_label,
                      row.operator_name,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={row.result === "granted" ? "default" : "destructive"}>
                    {t(`adminEventOnsite.results.${row.result}`, { defaultValue: row.result })}
                  </Badge>
                  <Badge variant="outline">
                    {t(`adminEventOnsite.directions.${row.direction}`, {
                      defaultValue: row.direction,
                    })}
                  </Badge>
                  <Badge variant="secondary">
                    {t(`adminEventOnsite.sources.${row.source}`, { defaultValue: row.source })}
                  </Badge>
                  {row.offline_admitted === null ? null : (
                    <Badge
                      variant="outline"
                      title={
                        row.offline_outcome !== null && isOfflineOutcome(row.offline_outcome)
                          ? t("adminEventOnsite.log.offlineOutcome", {
                              outcome: t(OFFLINE_OUTCOME_KEY[row.offline_outcome]),
                            })
                          : undefined
                      }
                    >
                      {t("adminEventOnsite.log.offlineBadge")}
                    </Badge>
                  )}
                  {row.conflict ? (
                    <Badge variant="destructive" title={t("adminEventOnsite.log.conflictHint")}>
                      {t("adminEventOnsite.log.conflictBadge")}
                    </Badge>
                  ) : null}
                  {row.repeat_count > 1 ? (
                    <Badge variant="outline">{`${t("adminEventOnsite.labels.repeatCount")}: ${row.repeat_count}`}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.occurred_at).toLocaleString(i18n.language)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <AdminPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      </AdminCatalogListState>
    </section>
  );
}
