// Organizm: „Strony i menu" wydarzenia.
//
// TRZY USTAWIENIA I JEDNA LISTA. Uklad strony glownej (preset albo pelna
// kompozycja w builderze), sposob prezentacji podstron (lista albo kafle)
// i lista samych podstron. Wszystkie trzy opisuja TO SAMO menu: kafle na
// stronie glownej i pozycje w pasku to jedna lista w dwoch prezentacjach,
// a nie dwie listy do osobnego utrzymania.
//
// „Standard" NIE WYLACZA BUILDERA. U nas builder jest zawsze - `standard` to
// ZAMKNIETY PRESET startowy, zeby redakcja nie projektowala strony od zera,
// a `advanced` to ta sama strona otwarta do pelnej kompozycji. Kolumna
// `events.home_design` zapisuje wybor, a nie odbiera narzedzie.
//
// LISTA CZYTA `event_pages` PRZEZ RPC - patrz `eventPagesApi`. Podzial na
// „w menu" i „pozostale" nie liczy sie juz z `pages.menu_order` (to bylo
// mapowanie tymczasowe, na kolumnie menu CALEGO serwisu), tylko z wlasnego
// mapowania wydarzenia.
//
// DWA PASKI ZAPISU BY SIE BILY, WIEC JEST JEDEN. Ustawienia ukladu i trybu
// prezentacji sa SZKICEM zapisywanym przyciskiem („Zapisz zmiany"), a operacje
// na liscie sa NATYCHMIASTOWE - przypiecie, odpiecie i kolejnosc ida do bazy
// od razu. To nie jest niespojnosc: pierwsze to wybor, ktory redaktor moze
// odrzucic, drugie to czynnosc, ktorej efekt musi zobaczyc od razu w podgladzie
// i w kolejnosci wierszy. Dlatego lista nie ma stanu „niezapisane".
//
// KOLEJNOSC NA STRZALKACH, NIE NA PRZECIAGANIU. Menu wydarzenia ma kilka
// pozycji, a nie kilkadziesiat; strzalki dzialaja z klawiatury i z czytnika
// ekranu bez zadnego dodatkowego trybu, przeciaganie wymaga sensorow
// klawiaturowych i komunikatow o stanie, zeby dac to samo. Kazde nacisniecie
// zapisuje CALA kolejnosc jednym wolaniem `admin_event_pages_reorder`.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LayoutGrid,
  Link2Off,
  Pencil,
  Eye,
  Plus,
  Rows,
} from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { useSyncEventPreview } from "@/components/admin/events/studio/EventStudioPreviewContext";
import { EventPageCreateDialog } from "@/components/admin/events/molecules/EventPageCreateDialog";
import { EventPageEntrySheet } from "@/components/admin/events/molecules/EventPageEntrySheet";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  EVENT_PAGE_DEFAULT_ICON,
  eventPageInput,
  eventPageLabel,
  isEventPageAttached,
  isModuleEventPage,
  moveEventPage,
  nextEventPageSortOrder,
  splitEventPages,
  type AttachedEventPageRow,
  type EventPageRow,
} from "@/lib/events/eventPagesApi";
import {
  useAdminEventPages,
  useCreateEventPage,
  useDetachEventPage,
  useEventPageDocument,
  useEventRootPage,
  useReorderEventPages,
  useSaveEventPage,
} from "@/lib/events/useAdminEventPages";
import { useEventGroups } from "@/lib/events/useEventTermsGroups";
import { useSaveEventGeneral } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { uiLang, type UiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

type HomeDesign = "standard" | "advanced";
type DisplayMode = "list" | "grid";

/**
 * `pages.status` -> etykieta panelu.
 *
 * SLOWNIK JEST WSPOLNY Z RESZTA PANELU (`admin.status.*`), bo status strony
 * jest tym samym statusem, co na liscie `/admin/pages` - wlasny zestaw zdan
 * dawalby dwie nazwy na jeden stan.
 */
function statusLabelKey(status: string): string {
  return `admin.status.${status}`;
}

export function EventPagesMenuPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const navigate = useNavigate();

  const savedDesign: HomeDesign = row.home_design === "advanced" ? "advanced" : "standard";
  const savedMode: DisplayMode = row.pages_display_mode === "grid" ? "grid" : "list";

  const [design, setDesign] = useState<HomeDesign>(savedDesign);
  const [mode, setMode] = useState<DisplayMode>(savedMode);

  useEffect(() => {
    setDesign(savedDesign);
    setMode(savedMode);
  }, [savedDesign, savedMode]);

  const save = useSaveEventGeneral(row.id);
  const dirty = design !== savedDesign || mode !== savedMode;

  const pagesQ = useAdminEventPages(row.id);
  const rootQ = useEventRootPage(row.root_page_id === "" ? null : row.root_page_id);
  const groupsQ = useEventGroups(row.id);
  const rootPageSlug = rootQ.data?.slug ?? null;

  const savePage = useSaveEventPage(row.id);
  const detachPage = useDetachEventPage(row.id);
  const reorderPages = useReorderEventPages(row.id);
  const createPage = useCreateEventPage(row.id);

  const [editedId, setEditedId] = useState<string | null>(null);
  // PODGLADANA STRONA TRZYMA `page_id`, nie `id` pozycji menu: podglad pyta
  // o tresc STRONY, a ta istnieje takze wtedy, gdy pozycji w menu nie ma.
  const [previewPageId, setPreviewPageId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const rows = useMemo(() => pagesQ.data ?? [], [pagesQ.data]);
  const documentQ = useEventPageDocument(previewPageId);
  const split = useMemo(() => splitEventPages(rows), [rows]);
  const menuIds = useMemo(() => split.menu.map((entry) => entry.id), [split.menu]);

  // Szuflada trzyma IDENTYFIKATOR, nie wiersz: po zapisie lista przychodzi
  // z bazy jako nowe obiekty, a szuflada otwarta nad starym obiektem
  // pokazywalaby wartosci sprzed zapisu.
  const editedEntry = useMemo(
    () => split.menu.concat(split.other.filter(isEventPageAttached)).find((e) => e.id === editedId),
    [split.menu, split.other, editedId],
  );

  // Podglad dostaje TE pozycje menu i TEN tryb prezentacji - kafle na stronie
  // glownej zmieniaja uklad razem z przelacznikiem, bez zapisu. Pozycje ida
  // w kolejnosci `sort_order`, bo tak ustawia je baza w liscie.
  const previewRow = useMemo(
    () => rows.find((page) => page.page_id === previewPageId) ?? null,
    [rows, previewPageId],
  );

  useSyncEventPreview({
    // Dopoki tresc sie wczytuje, podglad zostaje na stronie glownej - kanwa
    // przelaczona na strone bez dokumentu klamalaby, ze strona jest pusta.
    selectedPage:
      previewRow === null || documentQ.isPending
        ? null
        : {
            // Ta sama przestrzen identyfikatorow, co `key` pozycji menu nizej
            // (`entry.id`), zeby kanwa porownywala identyfikatory, a nie napisy.
            // `null` = wybrana strona nie jest przypieta do menu.
            key: split.menu.find((entry) => entry.page_id === previewRow.page_id)?.id ?? null,
            label: eventPageLabel(previewRow, lang),
            path: previewRow.page_path,
            document: documentQ.data ?? null,
          },
    pagesDisplayMode: mode,
    menu: split.menu.map((entry) => ({
      key: entry.id,
      label: eventPageLabel(entry, lang),
      icon: entry.icon ?? EVENT_PAGE_DEFAULT_ICON,
      color: entry.color ?? "",
    })),
  });

  const failed = (error: unknown) => toast.error(adminEventStudioErrorMessage(error));
  const saved = (key: string) => toast.success(t(key));

  const submit = () => {
    save.mutate(
      { id: row.id, home_design: design, pages_display_mode: mode },
      {
        onSuccess: () => saved("adminEvents.studio.toasts.pagesSaved"),
        onError: failed,
      },
    );
  };

  const moveEntry = (id: string, direction: -1 | 1) => {
    const next = moveEventPage(menuIds, id, direction);
    if (next === menuIds) return;
    reorderPages.mutate(next, {
      onSuccess: () => saved("adminEvents.studio.toasts.pageOrderSaved"),
      onError: failed,
    });
  };

  /** Przypiecie strony NIEPRZYPIETEJ - mapowania jeszcze nie ma, wiec bez `id`. */
  const attach = (page: EventPageRow, inMenu: boolean) => {
    savePage.mutate(
      {
        eventId: row.id,
        pageId: page.page_id,
        inMenu,
        sortOrder: inMenu ? nextEventPageSortOrder(split.menu) : 0,
        visibleToGroups: [],
      },
      { onSuccess: () => saved("adminEvents.studio.toasts.pageEntrySaved"), onError: failed },
    );
  };

  /** Zmiana obecnosci w menu na pozycji JUZ PRZYPIETEJ - pelny wiersz. */
  const setInMenu = (entry: AttachedEventPageRow, inMenu: boolean) => {
    savePage.mutate(
      eventPageInput(entry, {
        inMenu,
        sortOrder: inMenu ? nextEventPageSortOrder(split.menu) : entry.sort_order,
      }),
      { onSuccess: () => saved("adminEvents.studio.toasts.pageEntrySaved"), onError: failed },
    );
  };

  const detach = (entry: AttachedEventPageRow) => {
    detachPage.mutate(entry.id, {
      onSuccess: () => saved("adminEvents.studio.toasts.pageDetached"),
      onError: failed,
    });
  };

  // Po utworzeniu prowadzimy DO TRESCI, nie do listy: strona powstaje jako
  // szkic bez ani jednego bloku, wiec sama pozycja w menu nie jest jeszcze
  // niczym, co uczestnik moze otworzyc. Slug znamy dopiero z odswiezonej listy,
  // bo RPC oddaje identyfikator POZYCJI, a edytor stron adresuje slugiem.
  const create = (input: Parameters<typeof createPage.mutate>[0]) => {
    createPage.mutate(input, {
      onSuccess: async (entryId) => {
        setCreateOpen(false);
        const refreshed = await pagesQ.refetch();
        const slug = refreshed.data?.find((page) => page.id === entryId)?.page_slug ?? null;
        toast.success(
          t("adminEvents.studio.toasts.pageCreated"),
          slug === null
            ? undefined
            : {
                action: {
                  label: t("adminEvents.studio.pages.rowActions.editContent"),
                  onClick: () => {
                    void navigate({ to: "/admin/pages/$slug", params: { slug } });
                  },
                },
              },
        );
      },
      onError: failed,
    });
  };

  const listBusy =
    savePage.isPending || detachPage.isPending || reorderPages.isPending || createPage.isPending;

  /**
   * TRZY STANY PUSTEJ LISTY, TRZY ZDANIA.
   *
   * „Jeszcze nie wiem", „nie udalo sie" i „nic tu nie ma" to trzy rozne
   * informacje: pierwsze kaze czekac, drugie odswiezyc, trzecie sprawdzic, czy
   * wydarzenie jeszcze istnieje. Jeden napis na wszystkie trzy - a tak bylo -
   * kaze redaktorowi zgadywac, ktora z tych trzech rzeczy sie stala.
   *
   * `isLoading`, a nie `isPending`: zapytanie WYLACZONE zostaje w stanie
   * `pending` na zawsze, wiec ekran obiecywalby wczytywanie, ktore nie trwa.
   */
  const emptyListKey = pagesQ.isLoading
    ? "adminEvents.studio.pages.loading"
    : pagesQ.isError
      ? "adminEvents.studio.pages.loadFailed"
      : "adminEvents.studio.pages.noPagesYet";

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.pages")}>
      <EventStudioRow
        label={t("adminEvents.studio.pages.homeDesign")}
        description={t("adminEvents.studio.pages.homeDesignDescription")}
      >
        <EventStudioChoiceCard
          id="event-home-advanced"
          name="event-home-design"
          checked={design === "advanced"}
          label={t("adminEvents.studio.pages.advanced")}
          description={t("adminEvents.studio.pages.advancedDescription")}
          onSelect={() => setDesign("advanced")}
        >
          {rootPageSlug === null ? (
            <span className="mt-2 block text-xs text-muted-foreground">
              {t("adminEvents.studio.pages.noRootPage")}
            </span>
          ) : (
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link to="/admin/pages/$slug" params={{ slug: rootPageSlug }}>
                {t("adminEvents.studio.pages.customize")}
              </Link>
            </Button>
          )}
        </EventStudioChoiceCard>

        <EventStudioChoiceCard
          id="event-home-standard"
          name="event-home-design"
          checked={design === "standard"}
          label={t("adminEvents.studio.pages.standard")}
          description={t("adminEvents.studio.pages.standardDescription")}
          onSelect={() => setDesign("standard")}
        />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.pages.displayMode")}
        description={t("adminEvents.studio.pages.displayModeDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <EventStudioChoiceCard
            id="event-display-grid"
            name="event-display-mode"
            checked={mode === "grid"}
            label={t("adminEvents.studio.pages.grid")}
            icon={<LayoutGrid className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            onSelect={() => setMode("grid")}
          />
          <EventStudioChoiceCard
            id="event-display-list"
            name="event-display-mode"
            checked={mode === "list"}
            label={t("adminEvents.studio.pages.list")}
            icon={<Rows className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            onSelect={() => setMode("list")}
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.pages.pages")}
        description={t("adminEvents.studio.pages.pagesDescription")}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={createPage.isPending}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminEvents.studio.pages.createPage")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyList messageKey={emptyListKey} />
        ) : (
          <Tabs defaultValue="menu" className="space-y-3">
            {/* DWIE ZAKLADKI PO POLOWIE SZEROKOSCI - jak we wzorcu. Zakladek
                jest dokladnie dwie i nigdy nie bedzie wiecej (pozycja jest
                w menu albo poza nim), wiec `tabs-scroller` nie mial czego
                przewijac, a zwezone zakladki wygladaly jak poczatek dluzszej
                listy, ktorej nie ma. */}
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="menu">
                {t("adminEvents.studio.pages.menuPages")} ({split.menu.length})
              </TabsTrigger>
              <TabsTrigger value="other">
                {t("adminEvents.studio.pages.otherPages")} ({split.other.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="menu">
              {split.menu.length === 0 ? (
                <EmptyList messageKey="adminEvents.studio.pages.menuEmpty" />
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {split.menu.map((entry, index) => (
                    <MenuEntryRow
                      key={entry.id}
                      entry={entry}
                      lang={lang}
                      first={index === 0}
                      last={index === split.menu.length - 1}
                      busy={listBusy}
                      onEdit={() => setEditedId(entry.id)}
                      previewing={entry.page_id === previewPageId}
                      onPreview={() =>
                        setPreviewPageId((current) =>
                          current === entry.page_id ? null : entry.page_id,
                        )
                      }
                      onMove={(direction) => moveEntry(entry.id, direction)}
                      onDetach={() => detach(entry)}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="other">
              {split.other.length === 0 ? (
                <EmptyList messageKey="adminEvents.studio.pages.otherEmpty" />
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {split.other.map((page) => (
                    <OtherPageRow
                      key={page.page_id}
                      page={page}
                      lang={lang}
                      busy={listBusy}
                      onEdit={(entry) => setEditedId(entry.id)}
                      onAddToMenu={(entry) =>
                        entry === null ? attach(page, true) : setInMenu(entry, true)
                      }
                      onKeepOut={() => attach(page, false)}
                      onDetach={(entry) => detach(entry)}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => {
          setDesign(savedDesign);
          setMode(savedMode);
        }}
      />

      <EventPageEntrySheet
        open={editedEntry !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditedId(null);
        }}
        entry={editedEntry ?? null}
        groups={groupsQ.data ?? []}
        isSaving={savePage.isPending}
        onSubmit={(input) =>
          savePage.mutate(input, {
            onSuccess: () => {
              setEditedId(null);
              saved("adminEvents.studio.toasts.pageEntrySaved");
            },
            onError: failed,
          })
        }
      />

      <EventPageCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        eventId={row.id}
        isSaving={createPage.isPending}
        onSubmit={create}
      />
    </EventStudioPage>
  );
}

function EmptyList({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();
  return (
    <p className="rounded-md border border-dashed border-border p-4 text-[13px] text-muted-foreground">
      {t(messageKey)}
    </p>
  );
}

/**
 * Kolorowa ikona pozycji menu.
 *
 * ZAOKRAGLONY KWADRAT, NIE KOLO - i to jest ROZNICA MIEDZY POWIERZCHNIAMI, nie
 * niespojnosc. Wzorzec rysuje w PANELU kwadrat o promieniu ~8 px (zrzut „Pages
 * & menu"), a na FRONCIE - kolorowy krazek (zrzut 38, strona glowna
 * wydarzenia). Ujednolicenie ich na sile zepsulo by jedna z dwoch: panel to
 * lista do zarzadzania, front to nawigacja dla uczestnika.
 */
function EntryIcon({ icon, color }: { icon: string | null; color: string | null }) {
  return (
    <span
      aria-hidden="true"
      style={color === null ? undefined : { background: color, color: "#FFFFFF" }}
      className={
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
        (color === null ? "bg-muted text-muted-foreground" : "")
      }
    >
      <DynamicIcon name={icon ?? EVENT_PAGE_DEFAULT_ICON} size={16} />
    </span>
  );
}

/**
 * Znacznik jednej z pieciu pozycji zawsze obecnych.
 *
 * PO CO NAZYWAC TEN STAN. Pozycja modulowa wyglada w liscie jak kazda inna,
 * a ma o jeden przycisk mniej. Bez nazwy brak odpiecia wyglada na awarie panelu
 * - a to jest DECYZJA: piatka nalezy do wydarzenia z definicji i wraca przy
 * nastepnym wejsciu na ekran, nawet gdyby ktos ja skasowal w `/admin/pages`.
 *
 * WYJASNIENIE JEST DLA OBU ODBIORCOW: `title` dla myszy, `sr-only` dla czytnika
 * ekranu. Sam `title` nie dojezdza do czytnika, a sam napis „stala pozycja" nie
 * mowi, co z tego wynika.
 */
function ModuleBadge({ label }: { label: string }) {
  const { t } = useTranslation();
  const explanation = t("adminEvents.studio.pages.rowActions.moduleLocked", { label });
  return (
    <span
      title={explanation}
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
    >
      {t("adminEvents.studio.pages.states.module")}
      <span className="sr-only"> {explanation}</span>
    </span>
  );
}

/** Sciezka publiczna i status - dwie rzeczy, ktore mowia, czy pozycja dziala. */
function PageMeta({ page }: { page: EventPageRow }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{t(statusLabelKey(page.page_status))}</span>
      <span className="truncate font-mono">/{page.page_path}</span>
    </span>
  );
}

/**
 * Wiersz zakladki „W menu" - DWA ZESTAWY AKCJI w jednej liscie.
 *
 * Pozycja ZWYKLA ma podglad, kolejnosc, edycje pozycji, edycje tresci i ODPIECIE.
 * Pozycja MODULOWA (jedna z pieciu zawsze obecnych) ma wszystko poza odpieciem:
 * `admin_event_page_detach` odmawia jej wyjatkiem `module_page` (migracja
 * 20260826181500, krok 5), a przycisk, ktory zawsze konczy sie bledem, jest
 * gorszy od braku przycisku. Zamiast niego stoi znacznik nazywajacy ten stan
 * i wskazujacy droge, ktora zostaje: przelacznik „Pokaz w menu wydarzenia".
 */
function MenuEntryRow({
  entry,
  lang,
  first,
  last,
  busy,
  onEdit,
  previewing,
  onPreview,
  onMove,
  onDetach,
}: {
  entry: AttachedEventPageRow;
  lang: UiLang;
  first: boolean;
  last: boolean;
  busy: boolean;
  onEdit: () => void;
  previewing: boolean;
  onPreview: () => void;
  onMove: (direction: -1 | 1) => void;
  onDetach: () => void;
}) {
  const { t } = useTranslation();
  const label = eventPageLabel(entry, lang);
  const isModule = isModuleEventPage(entry);
  return (
    <li className="group/row flex items-center gap-3 px-3 py-2.5">
      <EntryIcon icon={entry.icon} color={entry.color} />
      {/* TYTUL JEST PRZYCISKIEM PODGLADU, bo „co ta strona zawiera" jest
          pierwszym pytaniem redaktora o wiersz - a klik w nazwe jest jedynym
          gestem, ktorego nie trzeba tlumaczyc. */}
      <button
        type="button"
        aria-pressed={previewing}
        onClick={onPreview}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={"block truncate text-[13px] font-medium " + (previewing ? "text-primary" : "")}
        >
          {label}
        </span>
        <PageMeta page={entry} />
      </button>
      {/* ZNACZNIK STOI POZA PRZYCISKIEM PODGLADU celowo: w srodku jego napis
          wszedlby do NAZWY tego przycisku i czytnik ekranu oglosilby caly
          akapit wyjasnienia jako etykiete akcji „pokaz w podgladzie". */}
      {isModule ? <ModuleBadge label={label} /> : null}
      {/* AKCJE UKRYTE WZROKOWO DO NAJECHANIA - jak we wzorcu, gdzie wiersz
          w spoczynku ma tylko ikone i etykiete. Ale ukryte WZROKOWO, nie
          usuniete: `opacity-0` zostawia przyciski w drzewie dostepnosci
          i w kolejnosci fokusa, a `display: none` by je z obu wyrzucil.
          Dlatego akcja widoczna wylacznie na hover byla by niedostepna
          z klawiatury - i dlatego sa tu TRZY warunki pokazania, nie jeden:
            * `group-hover/row` - mysz nad wierszem (wzorzec);
            * `group-focus-within/row` - fokus klawiatury gdziekolwiek
              w wierszu, wiec tabulator odslania te akcje sam;
            * `@media (hover: none)` - ekran dotykowy NIE MA hoveru, wiec tam
              akcje sa widoczne od razu. Bez tego czlonu na telefonie zostalyby
              przyciski niewidoczne, ale klikalne - najgorszy z trzech stanow.
          Kolejnosc idzie DALEJ STRZALKAMI (patrz naglowek pliku); przeciaganie
          wolno dolozyc obok nich, nie zamiast. */}
      <span
        className={
          "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity " +
          "group-hover/row:opacity-100 group-focus-within/row:opacity-100 " +
          "[@media(hover:none)]:opacity-100"
        }
      >
        <Button
          variant={previewing ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          aria-label={t("adminEvents.studio.pages.rowActions.preview", { label })}
          aria-pressed={previewing}
          onClick={onPreview}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={busy || first}
          aria-label={t("adminEvents.studio.pages.rowActions.moveUp", { label })}
          onClick={() => onMove(-1)}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={busy || last}
          aria-label={t("adminEvents.studio.pages.rowActions.moveDown", { label })}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={busy}
          aria-label={t("adminEvents.studio.pages.rowActions.edit", { label })}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
          <Link
            to="/admin/pages/$slug"
            params={{ slug: entry.page_slug }}
            aria-label={t("adminEvents.studio.pages.rowActions.editContent")}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
        {/* ODPIECIA NIE MA PRZY POZYCJI MODULOWEJ. Nie jest wylaczone, a NIE
            ISTNIEJE: przycisk wylaczony pyta „dlaczego dzisiaj nie", a tutaj
            odpowiedz jest „nigdy" - piatka nalezy do wydarzenia z definicji. */}
        {isModule ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={busy}
            aria-label={t("adminEvents.studio.pages.rowActions.detach", { label })}
            onClick={onDetach}
          >
            <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </span>
    </li>
  );
}

/**
 * Wiersz z zakladki „Pozostale strony" - DWA ROZNE STANY w jednej liscie.
 *
 * Strona PRZYPIETA poza menu ma juz ikone, kolor i widocznosc, wiec da sie ja
 * edytowac i odpiac; strona NIEPRZYPIETA nie ma jeszcze czego edytowac ani
 * odpinac - ma dwa wejscia: „do menu" albo „swiadomie poza menu". Znacznik przy
 * tytule nazywa ten stan, bo bez niego dwa rozne zestawy przyciskow w jednej
 * liscie wygladaja na przypadek.
 *
 * TRZECI STAN WSZEDL TUTAJ RAZEM Z PIATKA: pozycja MODULOWA ukryta
 * przelacznikiem `in_menu = false` laduje w tej samej zakladce - i tak samo jak
 * w „W menu" nie wolno jej odpiac. Gdyby ten wiersz zostal przy odpieciu, cala
 * oslona z kroku 5 migracji dalaby sie obejsc jednym przelaczeniem widocznosci.
 */
function OtherPageRow({
  page,
  lang,
  busy,
  onEdit,
  onAddToMenu,
  onKeepOut,
  onDetach,
}: {
  page: EventPageRow;
  lang: UiLang;
  busy: boolean;
  onEdit: (entry: AttachedEventPageRow) => void;
  onAddToMenu: (entry: AttachedEventPageRow | null) => void;
  onKeepOut: () => void;
  onDetach: (entry: AttachedEventPageRow) => void;
}) {
  const { t } = useTranslation();
  const attached = isEventPageAttached(page) ? page : null;
  const isModule = isModuleEventPage(page);
  const label = eventPageLabel(page, lang);
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      {attached === null ? null : <EntryIcon icon={attached.icon} color={attached.color} />}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{label}</span>
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {t(
              attached === null
                ? "adminEvents.studio.pages.states.unattached"
                : "adminEvents.studio.pages.states.attachedOutOfMenu",
            )}
          </span>
          {/* DWA ZNACZNIKI, NIE JEDEN. „Poza menu" mowi, gdzie ta pozycja
              teraz jest; „stala pozycja" mowi, czego z nia zrobic nie mozna.
              Zlaczenie ich w jeden napis zgubilo by jedna z tych dwoch rzeczy. */}
          {isModule ? <ModuleBadge label={label} /> : null}
        </span>
        <PageMeta page={page} />
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onAddToMenu(attached)}>
          {t("adminEvents.studio.pages.rowActions.addToMenu")}
        </Button>
        {attached === null ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onKeepOut}>
            {t("adminEvents.studio.pages.rowActions.keepOutOfMenu")}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={busy}
              aria-label={t("adminEvents.studio.pages.rowActions.edit", { label })}
              onClick={() => onEdit(attached)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            {isModule ? null : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                aria-label={t("adminEvents.studio.pages.rowActions.detach", { label })}
                onClick={() => onDetach(attached)}
              >
                <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
          <Link
            to="/admin/pages/$slug"
            params={{ slug: page.page_slug }}
            aria-label={t("adminEvents.studio.pages.rowActions.editContent")}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </span>
    </li>
  );
}
