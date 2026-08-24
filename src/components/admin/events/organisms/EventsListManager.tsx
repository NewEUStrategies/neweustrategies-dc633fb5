// Organizm: LISTA WYDARZEŃ modułu - filtry, zakładki, paginacja, tworzenie.
//
// ORGANIZM JEST KOMPOZYCJĄ. Model stanu URL i tłumaczenie na argumenty RPC żyją
// w `lib/events/eventListParams` (czysty moduł z tabelą przypadków). Czas liczy
// `lib/events/timezone`. Pasek filtrów i wiersz to molekuły. Tutaj zostaje
// SKLEJENIE: co idzie do zapytania, co się dzieje z odpowiedzią i co widzi
// redaktor, gdy nic nie pasuje.
//
// STAN JEST W URL-U, NIE W `useState`. Redaktor wraca do listy dziesiątki razy
// dziennie i za każdym razem ustawiałby te same trzy filtry. Stan w komponencie
// znaczy: nie da się wysłać linku, odświeżenie gubi filtr, a przycisk „wstecz"
// nie działa.
//
// PUSTY STAN MA DWIE WERSJE. „Nie ma żadnego wydarzenia" i „nic nie pasuje do
// tych filtrów" to dwie różne informacje: pierwsza mówi „dodaj pierwsze",
// druga „wyczyść filtry". Jedno zdanie dla obu przypadków wysyła redaktora
// szukać wydarzenia, które istnieje, w miejscu, gdzie go nie widać.
//
// LICZNIKI ZAKŁADEK IDĄ Z OSOBNEGO ZAPYTANIA, które IGNORUJE zakładkę statusu -
// inaczej „Szkice" pokazywałyby liczbę szkiców wśród szkiców.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { EventListFilters } from "@/components/admin/events/molecules/EventListFilters";
import { EventListRow } from "@/components/admin/events/molecules/EventListRow";
import {
  EventCreateDialog,
  type EventCreateDraft,
} from "@/components/admin/events/organisms/EventCreateDialog";
import { uiLang } from "@/lib/i18n/format";
import { EVENT_FORMATS, EVENT_FORMAT_LABEL_KEYS, asEventFormat } from "@/lib/events/eventTypes";
import {
  EVENT_LIST_PAGE_SIZES,
  EVENT_LIST_TABS,
  EVENT_LIST_TAB_LABEL_KEYS,
  eventListPageSize,
  eventListTab,
  hasEventListFilters,
  type EventListPageSize,
  type EventListParams,
  type EventListTab,
} from "@/lib/events/eventListParams";
import { eventTimeZoneLabel, formatEventDateTime } from "@/lib/events/timezone";
import {
  useAdminEventCounts,
  useAdminEventsList,
  useCreateEventFromType,
} from "@/lib/events/useAdminEvents";
import { useEventTypes } from "@/lib/events/useEventTypes";
import type { AdminEventListRow } from "@/lib/events/eventsListApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/** Wartość droplisty znaczy „wszystkie" - Radix nie przyjmuje pustego stringa. */
const ALL = "all";

export function EventsListManager({
  params,
  now,
  createOpen,
  onCreateOpenChange,
}: {
  params: EventListParams;
  /** Zegar podany z zewnątrz - granica „przyszłe/przeszłe" musi być testowalna. */
  now: Date;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const navigate = useNavigate();

  const listQ = useAdminEventsList(params, now);
  const countsQ = useAdminEventCounts(params);
  const typesQ = useEventTypes();
  const create = useCreateEventFromType();

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const total = rows[0]?.total_count ?? 0;
  const activeTab = eventListTab(params);

  /** Zmiana filtra ZERUJE stronę - inaczej filtr zawężający ląduje na stronie 6. */
  const patch = (next: Partial<EventListParams>) => {
    void navigate({
      to: "/admin/events/list",
      search: { ...params, ...next, page: undefined },
    });
  };

  const tabs = useMemo(
    () =>
      EVENT_LIST_TABS.map((tab) => ({
        key: tab,
        label: t(EVENT_LIST_TAB_LABEL_KEYS[tab]),
        count: countsQ.data?.[tab] ?? 0,
      })),
    [countsQ.data, t],
  );

  const typeOptions = useMemo(
    () => [
      { value: ALL, label: t("adminEvents.list.filters.typeAll") },
      ...(typesQ.data ?? []).map((type) => ({
        value: type.id,
        label: (lang === "en" ? type.name_en : type.name_pl) || type.key,
      })),
    ],
    [typesQ.data, lang, t],
  );

  const formatOptions = useMemo(
    () => [
      { value: ALL, label: t("adminEvents.list.filters.formatAll") },
      ...EVENT_FORMATS.map((format) => ({
        value: format,
        label: t(EVENT_FORMAT_LABEL_KEYS[format]),
      })),
    ],
    [t],
  );

  /** Zdania o zapisach. Chip powstaje TYLKO gdy liczba coś znaczy. */
  const metricsFor = (row: AdminEventListRow): string[] => {
    const out: string[] = [];
    if (row.going_count > 0) out.push(t("adminEvents.list.row.going", { count: row.going_count }));
    if (row.interested_count > 0) {
      out.push(t("adminEvents.list.row.interested", { count: row.interested_count }));
    }
    if (row.waitlist_count > 0) {
      out.push(t("adminEvents.list.row.waitlist", { count: row.waitlist_count }));
    }
    // Trzy stany, nie dwa: NULL znaczy „bez limitu", zero znaczy „brak wolnych".
    out.push(
      row.seats_left === null
        ? t("adminEvents.list.row.noCapacity")
        : t("adminEvents.list.row.seatsLeft", { count: row.seats_left }),
    );
    if (row.speakers_count > 0) {
      out.push(t("adminEvents.list.row.speakers", { count: row.speakers_count }));
    }
    return out;
  };

  const badgesFor = (row: AdminEventListRow): string[] => {
    const out: string[] = [];
    if (row.chatham_house) out.push(t("adminEvents.list.row.chathamHouse"));
    if (row.visibility === "members") out.push(t("adminEvents.list.row.membersOnly"));
    return out;
  };

  const submitCreate = (draft: EventCreateDraft) => {
    create.mutate(
      {
        eventTypeId: draft.eventTypeId,
        titlePl: draft.titlePl.trim(),
        titleEn: draft.titleEn.trim(),
        // Pole `datetime-local` oddaje czas BEZ strefy. Traktujemy go jako czas
        // lokalny przeglądarki i zamieniamy na chwilę - inaczej wydarzenie
        // wpisane o 10:00 zapisuje się jako 10:00 UTC, czyli 12:00 w Warszawie.
        startsAt: new Date(draft.startsAt).toISOString(),
        // Puste pole znaczy „nie podano", a nie „podano pusty adres". Serwer
        // i tak zeruje adres dla rodzajów, które go nie używają.
        externalRegistrationUrl:
          draft.externalRegistrationUrl.trim() === "" ? null : draft.externalRegistrationUrl.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t("adminEvents.list.toasts.created"));
          onCreateOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const pageSize = eventListPageSize(params);
  const filtered = hasEventListFilters(params) || activeTab !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminEvents.list.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("adminEvents.list.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => onCreateOpenChange(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminEvents.list.createAction")}
        </Button>
      </div>

      <EventListFilters
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => patch({ tab: key === ALL ? undefined : (key as EventListTab) })}
        query={params.q ?? ""}
        queryPlaceholder={t("adminEvents.list.searchPlaceholder")}
        onQueryChange={(value) => patch({ q: value.trim() === "" ? undefined : value })}
        typeLabel={t("adminEvents.list.filters.typeLabel")}
        typeValue={params.t ?? ALL}
        typeOptions={typeOptions}
        onTypeChange={(value) => patch({ t: value === ALL ? undefined : value })}
        formatLabel={t("adminEvents.list.filters.formatLabel")}
        formatValue={params.f ?? ALL}
        formatOptions={formatOptions}
        onFormatChange={(value) => patch({ f: value === ALL ? undefined : asEventFormat(value) })}
        clearLabel={t("adminEvents.list.clearFilters")}
        onClear={() => patch({ q: undefined, t: undefined, f: undefined })}
        hasFilters={hasEventListFilters(params)}
      />

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEvents.list.loading")}
        errorMessage={listQ.isError ? listQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={filtered ? t("adminEvents.list.emptyFiltered") : t("adminEvents.list.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => {
            const title = (lang === "en" ? row.title_en : row.title_pl) || row.slug;
            return (
              <li key={row.id}>
                <EventListRow
                  title={title}
                  slug={row.slug}
                  statusLabel={t(`adminEvents.list.status.${row.status}`)}
                  statusTone={
                    row.status === "published"
                      ? "published"
                      : row.status === "cancelled"
                        ? "cancelled"
                        : "draft"
                  }
                  typeName={
                    row.type_name_pl === null
                      ? t("adminEvents.list.row.noType")
                      : ((lang === "en" ? row.type_name_en : row.type_name_pl) ??
                        row.type_key ??
                        "")
                  }
                  typeIcon={row.type_icon}
                  typeAccentColor={row.type_accent_color}
                  formatLabel={t(EVENT_FORMAT_LABEL_KEYS[asEventFormat(row.format)])}
                  dateLabel={formatEventDateTime(row.starts_at, row.timezone, lang)}
                  timeZoneLabel={eventTimeZoneLabel(row.starts_at, row.timezone, lang)}
                  location={row.location}
                  badges={badgesFor(row)}
                  metrics={metricsFor(row)}
                  editLabel={t("adminEvents.list.row.editAction", { title })}
                  onEdit={() =>
                    void navigate({ to: "/admin/community/events", search: { q: row.slug } })
                  }
                  publicHref={row.status === "published" ? `/events/${row.slug}` : null}
                  publicLabel={t("adminEvents.list.row.openPublicAction", { title })}
                  hasStream={row.has_stream}
                  hasRecording={row.has_recording}
                  streamLabel={t("adminEvents.list.row.stream")}
                  recordingLabel={t("adminEvents.list.row.recording")}
                />
              </li>
            );
          })}
        </ul>

        {/* Paginacja jest SERWEROWA: RPC oddaje `total_count` funkcja okna,
            a rozmiar strony jedzie do `p_limit`. Molekula liczy tylko etykiety,
            wiec nadaje sie do obu trybow bez zmian. Zmiana rozmiaru ZERUJE
            strone - inaczej przejscie z 200 na 20 laduje na stronie, ktorej
            po zmianie nie ma. */}
        <AdminPagination
          page={params.page ?? 1}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={[...EVENT_LIST_PAGE_SIZES]}
          onPageChange={(page) =>
            void navigate({
              to: "/admin/events/list",
              search: { ...params, page: page <= 1 ? undefined : page },
            })
          }
          onPageSizeChange={(size) =>
            void navigate({
              to: "/admin/events/list",
              search: { ...params, size: size as EventListPageSize, page: undefined },
            })
          }
        />
      </AdminCatalogListState>

      <EventCreateDialog
        open={createOpen}
        types={typesQ.data ?? []}
        isSaving={create.isPending}
        onClose={() => onCreateOpenChange(false)}
        onSubmit={submitCreate}
      />
    </div>
  );
}
