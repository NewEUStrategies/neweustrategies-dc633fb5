// Lista ścieżek komunikacji (S8, SPEC §6.3) - tabela z wyszukiwaniem i filtrem
// statusu w ADRESIE (`?q=`, `?status=`), wiersz prowadzi do edytora
// (`/admin/revenue/journeys/$journeyId`).
//
// KOLUMNY = PYTANIA ADMINA: jak się nazywa i z jakiego szablonu, czy działa,
// na co startuje, ilu kontaktów jest w toku, ilu weszło i ilu doszło do celu
// w 30 dni, która wersja jest opublikowana. Liczby z `admin_journey_list`
// (zapisy testowe wykluczone po stronie bazy).
//
// FILTR W ADRESIE, NIE W STANIE. Link „Ścieżki · Wstrzymane” wysłany koledze
// i powrót z edytora (okruszki) pokazują tę samą listę; zakładka przepisuje
// `?q=` z `replace`, więc pisanie nie zaśmieca historii przeglądarki.
//
// AKCJE STATUSU TYLKO DLA ADMINA (`setJourneyStatus` = `requireAdmin`):
// wstrzymaj, wznów, archiwizuj - każda z potwierdzeniem i tokenem
// `updated_at` (wyścig z edytorem w innej karcie kończy się komunikatem
// o konflikcie zamiast cichego nadpisania). Wynik `ok:false` nie rzuca -
// tłumaczymy kod i powód (`mutationErrorText`).
//
// DOSTĘPNOŚĆ: tabela z `caption` i `scope`, nazwa ścieżki to nagłówek wiersza
// z odnośnikiem (klik w wiersz to tylko skrót myszy), przewijany region
// z `tabIndex=0` i nazwą (wąski ekran nie dostaje poziomego paska strony).
//
// POWRÓT Z EDYTORA (SPEC §2.4: okruszki zachowują `?status=&q=`). Parametry
// listy nie należą do kontraktu adresu edytora (`editorSearch.ts`), więc
// wejście do edytora zapamiętuje filtr w `sessionStorage` karty, a okruszki
// edytora go odczytują - przez TEN SAM walidator co adres huba, bo wartość
// z pamięci przeglądarki jest tak samo niezaufana jak adres.
import { useId, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Info, Lock, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminListToolbar } from "@/components/admin/molecules/AdminListToolbar";
import { Button } from "@/components/ui/button";
import { PlatformSelect } from "@/components/ui/platform-select";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import { mutationErrorText, useSetJourneyStatus } from "@/lib/admin/journeys/journeyMutations";
import { JOURNEY_STATUS_LABEL_KEY, matchesSearch } from "@/lib/admin/journeys/summaries";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import type { JourneyListItem } from "@/lib/journeys/dto";
import { journeyTriggerLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_STATUSES, parseRevenueHubSearch, type JourneyStatus } from "@/lib/revenue/search";

const LOCALE = { pl: "pl-PL", en: "en-GB" } as const;

const STATUS_ICON = {
  draft: Info,
  active: CheckCircle2,
  paused: Timer,
  archived: Lock,
} as const satisfies Record<JourneyStatus, unknown>;

type StatusAction = "paused" | "active" | "archived";

/** Klucz pamięci karty z filtrem listy (okruszki edytora). */
const LIST_SEARCH_STORAGE_KEY = "nes.journeyList.search";

/** Filtr listy w kształcie adresu zakładki (`?status=&q=`). */
export interface JourneyListSearch {
  status?: JourneyStatus;
  q?: string;
}

/**
 * Zapamiętuje filtr listy przed wejściem do edytora. Pusty filtr też jest
 * zapisem - inaczej okruszki wróciłyby do filtra sprzed kilku wejść.
 */
export function rememberJourneyListSearch(search: JourneyListSearch): void {
  try {
    window.sessionStorage.setItem(LIST_SEARCH_STORAGE_KEY, JSON.stringify(search));
  } catch {
    // Pamięć karty zablokowana (tryb prywatny, polityka) - okruszki wrócą do
    // pełnej listy, nic więcej się nie psuje.
  }
}

/** Ostatni filtr listy albo `{}` (brak, zablokowana pamięć, śmieci). */
export function recallJourneyListSearch(): JourneyListSearch {
  try {
    const raw = window.sessionStorage.getItem(LIST_SEARCH_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const { status, q } = parseRevenueHubSearch(parsed as Record<string, unknown>);
    return {
      ...(status !== undefined ? { status } : {}),
      ...(q !== undefined ? { q } : {}),
    };
  } catch {
    return {};
  }
}

export interface JourneyListProps {
  items: readonly JourneyListItem[] | null;
  isLoading: boolean;
  /** Komunikat awarii odczytu albo `null`. */
  errorMessage: string | null;
  status: JourneyStatus | null;
  query: string;
  onStatusChange: (status: JourneyStatus | null) => void;
  onQueryChange: (query: string) => void;
  tenantId: string | null;
  /** Admin: pauza, wznowienie, archiwum. */
  canChangeStatus: boolean;
  /** Pusta lista bez filtra - zakładka pokazuje obok galerię. */
  emptyLabel: string;
  /** Odmowa `aal2` przy zmianie statusu - zakładka pokazuje `MfaRequiredNotice`. */
  onMfaRequired?: () => void;
}

export function JourneyList({
  items,
  isLoading,
  errorMessage,
  status,
  query,
  onStatusChange,
  onQueryChange,
  tenantId,
  canChangeStatus,
  emptyLabel,
  onMfaRequired,
}: JourneyListProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const locale = LOCALE[chartLangFrom(i18n.language)];
  const navigate = useNavigate();
  const captionId = useId();
  const statusId = useId();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const setStatus = useSetJourneyStatus(tenantId);

  const triggerLabel = (item: JourneyListItem) =>
    item.triggerEventType
      ? t(journeyTriggerLabelKey(item.triggerEventType))
      : t("adminJourneys.list.noTrigger");

  // Szukanie obejmuje też PRZETŁUMACZONĄ nazwę wyzwalacza - admin wpisuje
  // „porzucona kasa”, a nie `checkout.abandoned.v1`.
  const visible = (items ?? []).filter(
    (item) =>
      (status === null || item.status === status) &&
      matchesSearch(query, item.name, item.key, item.triggerEventType ? triggerLabel(item) : ""),
  );

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);

  const run = async (item: JourneyListItem, next: StatusAction) => {
    try {
      const result = await setStatus.mutateAsync({
        journeyId: item.id,
        status: next,
        expectedUpdatedAt: item.updatedAt,
      });
      if (result.ok) toast.success(t(DONE_KEY[next]));
      else toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) onMfaRequired?.();
      else toast.error(t("adminJourneys.list.statusError"));
    }
  };

  const ask = (item: JourneyListItem, next: StatusAction) =>
    setConfirm({
      title: t(CONFIRM_KEY[next].title, { name: item.name }),
      description: t(CONFIRM_KEY[next].body),
      confirmLabel: t(ACTION_KEY[next].label),
      cancelLabel: t("adminJourneys.common.cancel"),
      destructive: next === "archived",
      onConfirm: () => run(item, next),
    });

  const filtered = status !== null || query.trim() !== "";
  const rememberFilter = () =>
    rememberJourneyListSearch({
      ...(status !== null ? { status } : {}),
      ...(query.trim() !== "" ? { q: query.trim() } : {}),
    });

  return (
    <div className="space-y-2">
      <AdminListToolbar
        search={query}
        onSearch={onQueryChange}
        searchPlaceholder={t("adminJourneys.list.searchPlaceholder")}
        hideStatus
        hideLang
        hideAuthor
        resultsCount={items ? visible.length : undefined}
        totalCount={items?.length}
        extraRight={
          <div className="flex items-center gap-2">
            <label htmlFor={statusId} className="sr-only">
              {t("adminJourneys.list.statusFilter")}
            </label>
            <PlatformSelect
              id={statusId}
              value={status ?? ""}
              className="h-8 w-44 text-xs"
              onChange={(event) => {
                const value = event.target.value;
                onStatusChange(
                  (JOURNEY_STATUSES as readonly string[]).includes(value)
                    ? (value as JourneyStatus)
                    : null,
                );
              }}
            >
              <option value="">{t("adminJourneys.list.statusAll")}</option>
              {JOURNEY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(JOURNEY_STATUS_LABEL_KEY[value])}
                </option>
              ))}
            </PlatformSelect>
          </div>
        }
      />
      <AdminCatalogListState
        isLoading={isLoading}
        loadingLabel={t("adminJourneys.list.loading")}
        errorMessage={errorMessage}
        isEmpty={visible.length === 0}
        emptyLabel={filtered ? t("adminJourneys.list.emptyFiltered") : emptyLabel}
      >
        <div
          role="region"
          aria-label={t("adminJourneys.list.scrollRegion")}
          tabIndex={0}
          className="overflow-x-auto rounded-[6px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[760px] text-left text-xs">
            <caption id={captionId} className="sr-only">
              {t("adminJourneys.list.caption")}
            </caption>
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.list.columns.name")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.list.columns.status")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.list.columns.trigger")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("adminJourneys.list.columns.active")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("adminJourneys.list.columns.enrolled30d")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("adminJourneys.list.columns.goal30d")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("adminJourneys.list.columns.version")}
                </th>
                {canChangeStatus ? (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("adminJourneys.list.columns.actions")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const StatusIcon = STATUS_ICON[item.status];
                return (
                  <tr
                    key={item.id}
                    data-journey-id={item.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/30"
                    onClick={(event) => {
                      // Skrót myszy: klik w wiersz otwiera edytor, ale nie
                      // przechwytuje odnośnika ani przycisków akcji.
                      if ((event.target as HTMLElement).closest("a, button")) return;
                      rememberFilter();
                      void navigate({
                        to: "/admin/revenue/journeys/$journeyId",
                        params: { journeyId: item.id },
                      });
                    }}
                  >
                    <th scope="row" className="px-3 py-2 align-top font-normal">
                      <Link
                        to="/admin/revenue/journeys/$journeyId"
                        params={{ journeyId: item.id }}
                        aria-label={t("adminJourneys.list.open", { name: item.name })}
                        onClick={rememberFilter}
                        className="font-medium text-foreground hover:underline focus-visible:underline"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{item.key}</span>
                        {item.templateKey ? (
                          <span>{t("adminJourneys.list.fromTemplate")}</span>
                        ) : null}
                      </div>
                    </th>
                    <td className="px-3 py-2 align-top">
                      <span
                        data-status={item.status}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium"
                      >
                        <StatusIcon className="h-3 w-3" aria-hidden="true" />
                        {t(JOURNEY_STATUS_LABEL_KEY[item.status])}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">{triggerLabel(item)}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(item.active)}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(item.enrolled30d)}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(item.goalReached30d)}
                      {item.enrolled30d > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("adminJourneys.list.goalRate", {
                            rate: percent(item.goalReached30d / item.enrolled30d),
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {item.version === null
                        ? t("adminJourneys.list.versionNone")
                        : t("adminJourneys.list.versionValue", { version: item.version })}
                    </td>
                    {canChangeStatus ? (
                      <td className="px-3 py-2 text-right align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {actionsFor(item).map((next) => (
                            <Button
                              key={next}
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={setStatus.isPending}
                              aria-label={t(ACTION_KEY[next].aria, { name: item.name })}
                              onClick={() => ask(item, next)}
                            >
                              {t(ACTION_KEY[next].label)}
                            </Button>
                          ))}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AdminCatalogListState>
      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </div>
  );
}

/**
 * Dozwolone przejścia statusu z listy: aktywna -> wstrzymana, wstrzymana ->
 * aktywna, każda niezarchiwizowana -> archiwum. Szkic aktywuje się publikacją
 * w edytorze (z blokadami i podsumowaniem), nie przyciskiem na liście.
 */
function actionsFor(item: JourneyListItem): StatusAction[] {
  const out: StatusAction[] = [];
  if (item.status === "active") out.push("paused");
  if (item.status === "paused") out.push("active");
  if (item.status !== "archived") out.push("archived");
  return out;
}

const ACTION_KEY: Readonly<Record<StatusAction, { label: string; aria: string }>> = {
  paused: {
    label: "adminJourneys.list.actions.pause",
    aria: "adminJourneys.list.actions.pauseFor",
  },
  active: {
    label: "adminJourneys.list.actions.resume",
    aria: "adminJourneys.list.actions.resumeFor",
  },
  archived: {
    label: "adminJourneys.list.actions.archive",
    aria: "adminJourneys.list.actions.archiveFor",
  },
};

const CONFIRM_KEY: Readonly<Record<StatusAction, { title: string; body: string }>> = {
  paused: {
    title: "adminJourneys.list.confirm.pauseTitle",
    body: "adminJourneys.list.confirm.pauseBody",
  },
  active: {
    title: "adminJourneys.list.confirm.resumeTitle",
    body: "adminJourneys.list.confirm.resumeBody",
  },
  archived: {
    title: "adminJourneys.list.confirm.archiveTitle",
    body: "adminJourneys.list.confirm.archiveBody",
  },
};

const DONE_KEY: Readonly<Record<StatusAction, string>> = {
  paused: "adminJourneys.list.done.paused",
  active: "adminJourneys.list.done.active",
  archived: "adminJourneys.list.done.archived",
};
