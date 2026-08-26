// Organizm: LISTA WYDARZEŃ modułu - pasek narzędzi, tabela, operacje masowe.
//
// ORGANIZM JEST KOMPOZYCJĄ. Model stanu URL i tłumaczenie na argumenty RPC żyją
// w `lib/events/eventListParams` (czysty moduł z tabelą przypadków). Czas liczy
// `lib/events/timezone`. Pasek narzędzi i wiersze tabeli to molekuły. Tutaj
// zostaje SKLEJENIE: co idzie do zapytania, co się dzieje z odpowiedzią i co
// widzi redaktor, gdy nic nie pasuje.
//
// STAN JEST W URL-U, NIE W `useState`. Redaktor wraca do listy dziesiątki razy
// dziennie i za każdym razem ustawiałby te same trzy filtry. Stan w komponencie
// znaczy: nie da się wysłać linku, odświeżenie gubi filtr, a przycisk „wstecz”
// nie działa. Wyjątki są dwa i oba są nazwane niżej: SORTOWANIE (bo model URL go
// nie zna) i ZAZNACZENIE WIERSZY (bo jest ulotne).
//
// LISTA JEST TABELĄ, NIE STOSEM KART. Uzasadnienie stoi w molekule wiersza:
// redaktor porównuje wydarzenia w pionie, a karta z chipami ma tyle elementów,
// ile ma niepustych wartości.
//
// PUSTY STAN MA DWIE WERSJE. „Nie ma żadnego wydarzenia” i „nic nie pasuje do
// tych filtrów” to dwie różne informacje: pierwsza mówi „dodaj pierwsze”,
// druga „wyczyść filtry”. Jedno zdanie dla obu przypadków wysyła redaktora
// szukać wydarzenia, które istnieje, w miejscu, gdzie go nie widać.
//
// LICZNIKI ZAKŁADEK IDĄ Z OSOBNEGO ZAPYTANIA, które IGNORUJE zakładkę statusu -
// inaczej „Szkice” pokazywałyby liczbę szkiców wśród szkiców.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader } from "@/components/ui/table";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminPagination } from "@/components/admin/molecules/AdminPagination";
import { EventListFilters } from "@/components/admin/events/molecules/EventListFilters";
import {
  EventListHeaderRow,
  EventListRow,
  type EventTableColumnLabels,
  type EventTableSort,
  type EventTableSortKey,
} from "@/components/admin/events/molecules/EventListRow";
import { uiLang } from "@/lib/i18n/format";
import { csvDocument } from "@/lib/crm/csv";
import { csvFileNameFor } from "@/lib/csv/formatCsv";
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
  adminEventKeys,
  useAdminEventCounts,
  useAdminEventsList,
} from "@/lib/events/useAdminEvents";
import { useEventTypes } from "@/lib/events/useEventTypes";
import { fetchAdminEvents, type AdminEventListRow } from "@/lib/events/eventsListApi";
import { deleteEvent, runEventReminders } from "@/lib/admin/community";
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/** Wartość droplisty znaczy „wszystkie” - Radix nie przyjmuje pustego stringa. */
const ALL = "all";

/**
 * Kolumny pliku eksportu w kolejności zapisu, z NAGŁÓWKAMI TECHNICZNYMI - ta
 * sama konwencja co `lib/events/registrationsCsv`. Plik trafia do arkusza
 * i skryptu, a nie na ekran: nazwa kolumny musi być ta sama niezależnie od
 * języka interfejsu, w którym redaktor kliknął eksport.
 *
 * Termin jedzie SUROWYM ISO plus osobną kolumną strefy, a nie sformatowanym
 * napisem. Odbiorca pliku sortuje i odejmuje daty, więc „27 listopada 2025,
 * 9:00” jest dla niego tekstem, a nie datą.
 */
const EXPORT_COLUMNS = [
  "slug",
  "title_pl",
  "title_en",
  "starts_at",
  "timezone",
  "type",
  "format",
  "location",
  "status",
  "going_count",
  "waitlist_count",
  "seats_left",
  "speakers_count",
] as const;

/** Strona eksportu równa CLAMP-owi w `admin_events_list` - większa i tak zostałaby przycięta. */
const EXPORT_CHUNK: EventListPageSize = 200;

/**
 * Twardy sufit pętli eksportu. Bez niego błąd w liczniku całości (albo wiersz
 * dopisany między stronami) zamienia eksport w nieskończoną serię zapytań.
 */
const EXPORT_MAX_PAGES = 50;

/**
 * Porównanie tekstów z PUSTYMI NA KOŃCU niezależnie od kierunku.
 *
 * Brak wartości nie jest ani najmniejszą, ani największą wartością - jest brakiem
 * odpowiedzi. Odwracany razem z kierunkiem wypychałby wiersze bez tytułu na samą
 * górę listy przy jednym kliknięciu.
 */
function byText(a: string, b: string, lang: string, factor: number): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return factor * a.localeCompare(b, lang);
}

/** To samo dla znaczników ISO - porównywalnych leksykograficznie bez parsowania. */
function byIso(a: string, b: string, factor: number): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return factor * (a < b ? -1 : 1);
}

export function EventsListManager({
  params,
  now,
}: {
  params: EventListParams;
  /** Zegar podany z zewnątrz - granica „przyszłe/przeszłe” musi być testowalna. */
  now: Date;
}) {
  ensureAdminEventsI18n();
  // Slownik sekcji spolecznosci: akcja przypomnien PRZENIOSLA sie tutaj razem
  // ze swoimi tekstami. Drugi klucz na ten sam napis (z formami mnogimi!)
  // rozjechalby sie przy pierwszej korekcie.
  ensureCommunityEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const navigate = useNavigate();

  const listQ = useAdminEventsList(params, now);
  const countsQ = useAdminEventCounts(params);
  const typesQ = useEventTypes();

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

  /** Tytuł w języku interfejsu; brak tytułu w tym języku degraduje do adresu. */
  const titleOf = (row: AdminEventListRow): string =>
    (lang === "en" ? row.title_en : row.title_pl) || row.slug;

  const typeNameOf = (row: AdminEventListRow): string =>
    row.type_name_pl === null
      ? t("adminEvents.list.row.noType")
      : ((lang === "en" ? row.type_name_en : row.type_name_pl) ?? row.type_key ?? "");

  /**
   * Zdania, które TŁUMACZĄ liczbę zapisanych: kolejka, zainteresowani i wolne
   * miejsca. Kolumna z samą liczbą nie odróżnia wydarzenia z pustą salą od
   * wyprzedanego z kolejką - a to są przeciwne decyzje organizatora.
   *
   * „Bez limitu miejsc” NIE jest zdaniem w tabeli, choć jest jednym z trzech
   * stanów pojemności (`seats_left IS NULL`). Powtórzone w dwudziestu wierszach
   * przykrywa te wiersze, w których limit istnieje i właśnie się kończy - a brak
   * limitu widać po tym, że wiersz nie mówi o miejscach nic.
   */
  const registrationNotesFor = (row: AdminEventListRow): string[] => {
    const out: string[] = [];
    if (row.interested_count > 0) {
      out.push(t("adminEvents.list.row.interested", { count: row.interested_count }));
    }
    if (row.waitlist_count > 0) {
      out.push(t("adminEvents.list.row.waitlist", { count: row.waitlist_count }));
    }
    if (row.seats_left !== null) {
      out.push(t("adminEvents.list.row.seatsLeft", { count: row.seats_left }));
    }
    return out;
  };

  const badgesFor = (row: AdminEventListRow): string[] => {
    const out: string[] = [];
    if (row.chatham_house) out.push(t("adminEvents.list.row.chathamHouse"));
    if (row.visibility === "members") out.push(t("adminEvents.list.row.membersOnly"));
    return out;
  };

  const pageSize = eventListPageSize(params);
  const filtered = hasEventListFilters(params) || activeTab !== "all";

  // SORTOWANIE JEST W `useState`, WBREW REGULE Z NAGLOWKA - i nie jest to wybor,
  // tylko granica tej zmiany. `EventListParams` nie ma pola porzadku, a
  // `parseEventListParams` ODRZUCA nieznane pola, wiec klucz dopisany do adresu
  // wyparowuje przy pierwszym odswiezeniu (`validateSearch` trasy wola ten sam
  // walidator). Pole w modelu URL to zmiana w `lib/events/eventListParams` i w
  // trasie - oba pliki naleza do innego przebiegu.
  //
  // SORTUJEMY WIDOCZNA STRONE. `admin_events_list` nie ma argumentu porzadku,
  // a paginacja jest SERWEROWA - porzadek calego zbioru wymaga zmiany RPC.
  const [sort, setSort] = useState<EventTableSort | null>(null);

  /** Trzecie kliknięcie WRACA do porządku serwera - „bez sortowania” jest stanem. */
  const cycleSort = (key: EventTableSortKey) => {
    setSort((current) =>
      current === null || current.key !== key
        ? { key, dir: "asc" }
        : current.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    );
  };

  const visible = useMemo(() => {
    if (sort === null) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return [...rows].sort((a, b) => {
      switch (key) {
        case "title":
          return byText(titleOf(a), titleOf(b), lang, factor);
        case "date":
          return byIso(a.starts_at, b.starts_at, factor);
        case "registrations":
          return factor * (a.going_count - b.going_count);
        case "speakers":
          return factor * (a.speakers_count - b.speakers_count);
      }
    });
    // `titleOf` czyta tylko `lang`, więc lista zależności jest kompletna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, lang]);

  // ZAZNACZENIE IDZIE DO `useState`, i tu regula z naglowka pliku nie ma
  // zastosowania: filtr jest wart linku, a „mam zaznaczone trzy wiersze” nie -
  // adres otwierajacy komus zaznaczenie przed operacja masowa to pulapka.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);

  /**
   * Zaznaczenie PRZYCIĘTE do widocznych wierszy. Po zmianie filtra albo strony
   * pasek operacji masowych nie może liczyć wydarzeń, których redaktor już nie
   * widzi - kasowanie „trzech zaznaczonych” musi znaczyć te trzy, które są na
   * ekranie.
   */
  const selected = useMemo(
    () => selectedIds.filter((id) => rowIds.includes(id)),
    [selectedIds, rowIds],
  );

  const columnLabels: EventTableColumnLabels = {
    title: t("adminEvents.list.columns.title"),
    date: t("adminEvents.list.columns.date"),
    type: t("adminEvents.list.columns.type"),
    format: t("adminEvents.list.columns.format"),
    location: t("adminEvents.list.columns.location"),
    status: t("adminEvents.list.columns.status"),
    registrations: t("adminEvents.list.columns.registrations"),
    speakers: t("adminEvents.list.columns.speakers"),
  };

  const sortLabels: Record<EventTableSortKey, string> = {
    title: t("adminEvents.list.sort.by", { column: columnLabels.title }),
    date: t("adminEvents.list.sort.by", { column: columnLabels.date }),
    registrations: t("adminEvents.list.sort.by", { column: columnLabels.registrations }),
    speakers: t("adminEvents.list.sort.by", { column: columnLabels.speakers }),
  };

  // PRZYPOMNIENIA SA AKCJA MODULU, NIE WYDARZENIA. `run_event_reminders()`
  // przechodzi WSZYSTKIE wydarzenia, ktorym termin przypomnienia wlasnie minal -
  // ten sam przycisk na ekranie jednego wydarzenia klamalby o zasiegu.
  // Harmonogram robi to sam (`jobsTick`); przycisk jest dla sytuacji, w ktorej
  // trzeba popchnac kolejke wczesniej i widziec wynik od razu.
  const qc = useQueryClient();
  const remindersM = useMutation({
    mutationFn: runEventReminders,
    onSuccess: (count) => toast.success(t("adminCommunityEvents.toasts.remindersSent", { count })),
    onError: (error: Error) => toast.error(error.message),
  });

  // USUWANIE WRACA TUTAJ Z WYCOFANEJ TRASY `/admin/community/events`. Tamten
  // ekran byl JEDYNYM miejscem, z ktorego dalo sie usunac wydarzenie, wiec
  // przekierowanie zabralo redaktorowi cala operacje - studio jej nie ma
  // i nie powinno miec: kasowanie z wnetrza edytowanego wydarzenia zostawia
  // otwarty ekran czegos, czego juz nie ma.
  //
  // KOSZ ZNIKNAL Z WIERSZA I STOI NA PASKU OPERACJI MASOWYCH. Wzorzec nie ma
  // w wierszu zadnej akcji, a kosz powtorzony dwadziescia razy to dwadziescia
  // okazji na kliknięcie, ktorego nie da sie cofnac. Zaznaczenie jest tu bramka:
  // zeby usunac, trzeba najpierw powiedziec CO.
  //
  // OTWARTE PYTANIE „usunac?” JEST W `useState`, wbrew regule z naglowka pliku -
  // i to jest ta jedna rzecz, ktorej w adresie byc NIE MOZE. Filtry sa warte
  // linku, potwierdzenie usuniecia nie: link, ktory komus otwiera to okno, jest
  // pulapka, a nie udogodnieniem.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteM = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      // PO KOLEI, nie `Promise.all`. Przy odmowie na trzecim wydarzeniu dwa
      // pierwsze juz nie istnieja, a rownolegle zapytania zostawiaja stan,
      // ktorego z jednego bledu nikt nie odczyta.
      for (const id of ids) await deleteEvent(id);
    },
    onSuccess: () => {
      toast.success(t("adminCommunityEvents.toasts.deleted"));
      setSelectedIds([]);
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      // Uniewaznienie TAKZE po bledzie: czesc wierszy mogla juz zniknac, a lista
      // pokazujaca skasowane wydarzenia jest gorsza niz komunikat o bledzie.
      // Ten sam zestaw co przy tworzeniu: lista, liczniki zakladek i stara lista
      // w sekcji spolecznosci czytaja te same wiersze.
      void qc.invalidateQueries({ queryKey: adminEventKeys.all });
      void qc.invalidateQueries({ queryKey: ["admin-community-events"] });
      setConfirmDelete(false);
    },
  });

  // EKSPORT BIERZE CALY ZAWEZONY ZBIOR, nie widoczna strone. Plik nazwany
  // „events-2026-08-26.csv” z dwudziestoma wierszami klamie o tym, ile jest
  // wydarzen, i nikt nie zgaduje, ze dostal jedna strone - a pomylka wychodzi
  // dopiero u odbiorcy pliku, poza systemem.
  const [exporting, setExporting] = useState(false);
  const exportAll = async (): Promise<void> => {
    setExporting(true);
    try {
      const all: AdminEventListRow[] = [];
      for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
        const chunk = await fetchAdminEvents({ ...params, page, size: EXPORT_CHUNK }, now);
        all.push(...chunk);
        const count = chunk[0]?.total_count ?? 0;
        if (chunk.length < EXPORT_CHUNK || all.length >= count) break;
      }
      const csv = csvDocument(
        EXPORT_COLUMNS,
        all.map((row) => [
          row.slug,
          row.title_pl,
          row.title_en,
          row.starts_at,
          row.timezone,
          typeNameOf(row),
          t(EVENT_FORMAT_LABEL_KEYS[asEventFormat(row.format)]),
          row.location,
          t(`adminEvents.list.status.${row.status}`),
          row.going_count,
          row.waitlist_count,
          row.seats_left,
          row.speakers_count,
        ]),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileNameFor("events", new Date().toISOString());
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Zwolnienie w NASTEPNEJ klatce - Safari przerywa pobieranie, gdy adres
      // znika synchronicznie po kliknieciu.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* NAGLOWEK EKRANU JEST H1, nie H2. To jedyny naglowek tego ekranu i nazwa
          sekcji - wariant A wzorca (zrzuty 04 i 08). H2 bez zadnego H1 nad soba
          zostawia drzewo naglowkow bez korzenia, a siostrzany ekran tworzenia
          (`EventCreateForm`) juz jest H1: przejscie miedzy nimi zmienialo poziom
          tego samego miejsca w hierarchii. Rozmiar zostaje przy `text-lg`, bo
          `EventStudioPage` (`font-display text-2xl`) jest naglowkiem RAMY STUDIA,
          a ta lista stoi poza ta rama. */}
      <div>
        <h1 className="text-lg font-semibold">{t("adminEvents.list.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminEvents.list.subtitle")}</p>
      </div>

      <EventListFilters
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => patch({ tab: key === ALL ? undefined : (key as EventListTab) })}
        query={params.q ?? ""}
        // KROTKI PLACEHOLDER, bo pole stoi teraz w jednym rzedzie z filtrami
        // i akcjami - pelne zdanie o tytule, adresie i miejscu ucinalo sie
        // w polowie, a ucieta podpowiedz nie podpowiada niczego.
        queryPlaceholder={t("adminEvents.list.searchPlaceholderShort")}
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
        moduleAction={{
          label: t("adminCommunityEvents.remindersAction"),
          onSelect: () => remindersM.mutate(),
          pending: remindersM.isPending,
        }}
        settingsAction={{
          label: t("adminEvents.list.toolbar.eventTypes"),
          onSelect: () => void navigate({ to: "/admin/events/types" }),
        }}
        // GNIAZDO EKSPORTU ZNIKA, GDY NIE MA CZEGO EKSPORTOWAC. Przycisk, ktory
        // oddaje plik z samym wierszem naglowka, uczy redaktora, ze przyciski
        // nie robia tego, co obiecuja.
        exportAction={
          total === 0
            ? undefined
            : {
                label: t("adminEvents.list.toolbar.export"),
                onSelect: () => void exportAll(),
                pending: exporting,
              }
        }
        // Tworzenie ma WLASNY ADRES (`/admin/events/new`), wiec redaktor moze
        // wrocic „wstecz”, odswiezyc i przeslac link - okno modalne odcinalo
        // formularz od historii przegladarki.
        primaryAction={{
          label: t("adminEvents.list.createAction"),
          onSelect: () => void navigate({ to: "/admin/events/new" }),
        }}
      />

      {/* PASEK OPERACJI MASOWYCH POJAWIA SIE PO ZAZNACZENIU i nie zajmuje
          miejsca, gdy nic nie jest zaznaczone. Licznik jest pierwszy, bo to on
          odpowiada na pytanie „czego dotyczy to, co zaraz kliknę”. */}
      {selected.length === 0 ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-sm">
            {t("adminEvents.list.select.count", { count: selected.length })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              {t("adminEvents.list.select.clear")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              {t("adminCommunityEvents.actions.deleteEvent")}
            </Button>
          </div>
        </div>
      )}

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEvents.list.loading")}
        errorMessage={listQ.isError ? listQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={filtered ? t("adminEvents.list.emptyFiltered") : t("adminEvents.list.empty")}
      >
        <div className="overflow-hidden rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <EventListHeaderRow
                labels={columnLabels}
                sortLabels={sortLabels}
                directionLabels={{
                  asc: t("adminEvents.list.sort.asc"),
                  desc: t("adminEvents.list.sort.desc"),
                }}
                sort={sort}
                onSort={cycleSort}
                selectAllLabel={t("adminEvents.list.select.all")}
                selectedAll={rows.length > 0 && selected.length === rows.length}
                selectedSome={selected.length > 0 && selected.length < rows.length}
                onSelectAll={(next) => setSelectedIds(next ? rowIds : [])}
              />
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const title = titleOf(row);
                return (
                  <EventListRow
                    key={row.id}
                    selected={selected.includes(row.id)}
                    selectLabel={t("adminEvents.list.select.row", { title })}
                    onSelectedChange={(next) =>
                      setSelectedIds((current) =>
                        next
                          ? [...current.filter((id) => id !== row.id), row.id]
                          : current.filter((id) => id !== row.id),
                      )
                    }
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
                    typeName={typeNameOf(row)}
                    typeIcon={row.type_icon}
                    typeAccentColor={row.type_accent_color}
                    formatLabel={t(EVENT_FORMAT_LABEL_KEYS[asEventFormat(row.format)])}
                    dateLabel={formatEventDateTime(row.starts_at, row.timezone, lang)}
                    timeZoneLabel={eventTimeZoneLabel(row.starts_at, row.timezone, lang)}
                    location={row.location}
                    badges={badgesFor(row)}
                    registrationsCount={row.going_count}
                    registrationNotes={registrationNotesFor(row)}
                    speakersCount={row.speakers_count}
                    editLabel={t("adminEvents.list.row.editAction", { title })}
                    // EDYCJA PROWADZI DO STUDIA, nie do starej listy w sekcji
                    // społeczności z wydarzeniem wyszukanym po slugu. Tamten
                    // adres dawał wynik wyszukiwania, a nie wydarzenie: jeden
                    // formularz z częścią pól i zero dojścia do stron, brandingu
                    // czy zapisów. Studio otwiera to samo wydarzenie ze wszystkimi
                    // sekcjami i bez pośrednika w postaci frazy szukania.
                    onEdit={() =>
                      void navigate({
                        to: "/admin/events/$eventId/general",
                        params: { eventId: row.id },
                      })
                    }
                    publicHref={row.status === "published" ? `/events/${row.slug}` : null}
                    publicLabel={t("adminEvents.list.row.openPublicAction", { title })}
                    hasStream={row.has_stream}
                    hasRecording={row.has_recording}
                    streamLabel={t("adminEvents.list.row.stream")}
                    recordingLabel={t("adminEvents.list.row.recording")}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Paginacja jest SERWEROWA: RPC oddaje `total_count` funkcja okna,
            a rozmiar strony jedzie do `p_limit`. Molekula liczy tylko etykiety,
            wiec nadaje sie do obu trybow bez zmian, i sama znika, gdy zbior
            miesci sie na jednej stronie. Zmiana rozmiaru ZERUJE strone -
            inaczej przejscie z 200 na 20 laduje na stronie, ktorej po zmianie
            nie ma. */}
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

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent className="event-dialog-compact">
          <DialogHeader>
            <DialogTitle>{t("adminCommunityEvents.deleteTitle")}</DialogTitle>
          </DialogHeader>
          {/* ZAKRES OPERACJI JEST W TRESCI, nie w tytule. Pytanie „Usunąć
              wydarzenie?” nad zaznaczeniem trzech wydarzeń pyta o coś innego,
              niż się stanie - a liczba jest tu jedyną informacją, której nie
              da się odzyskać po kliknięciu. */}
          <p className="text-sm text-muted-foreground">
            {t("adminEvents.list.select.count", { count: selected.length })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("adminCommunityEvents.common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteM.isPending || selected.length === 0}
              onClick={() => deleteM.mutate(selected)}
            >
              {t("adminCommunityEvents.common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
