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
// LISTA PODSTRON CZYTA `pages`, a nie wlasna tabele - patrz `eventPagesApi`.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, LayoutGrid, Plus, Rows } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { useSyncEventPreview } from "@/components/admin/events/studio/EventStudioPreviewContext";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  fetchEventPages,
  fetchEventRootPage,
  splitEventPages,
  type EventPageRow,
} from "@/lib/events/eventPagesApi";
import { useSaveEventGeneral } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

type HomeDesign = "standard" | "advanced";
type DisplayMode = "list" | "grid";

export function EventPagesMenuPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

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

  const rootPageId = row.root_page_id === "" ? null : row.root_page_id;
  const pagesQ = useQuery({
    queryKey: ["admin-event-pages", rootPageId],
    queryFn: () => fetchEventPages(rootPageId),
    enabled: rootPageId !== null,
  });

  // Korzen czytamy osobno WYLACZNIE dla slugu: edytor stron adresuje strone
  // slugiem, a `events.root_page_id` trzyma identyfikator.
  const rootQ = useQuery({
    queryKey: ["admin-event-root-page", rootPageId],
    queryFn: () => fetchEventRootPage(rootPageId),
    enabled: rootPageId !== null,
  });
  const rootPageSlug = rootQ.data?.slug ?? null;

  const rows = useMemo(() => pagesQ.data ?? [], [pagesQ.data]);
  const split = useMemo(() => splitEventPages(rows), [rows]);

  const titleOf = (page: EventPageRow): string =>
    lang === "en" ? page.title_en || page.title_pl : page.title_pl || page.title_en;

  // Podglad dostaje TE pozycje menu i TEN tryb prezentacji - kafle na stronie
  // glownej zmieniaja uklad razem z przelacznikiem, bez zapisu.
  useSyncEventPreview({
    pagesDisplayMode: mode,
    menu: split.menu.map((page) => ({
      key: page.id,
      label: titleOf(page),
      icon: "file-text",
      color: "",
    })),
  });

  const submit = () => {
    save.mutate(
      { id: row.id, home_design: design, pages_display_mode: mode },
      {
        onSuccess: () => toast.success(t("adminEvents.studio.toasts.pagesSaved")),
        onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
      },
    );
  };

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
          <Button asChild size="sm">
            <Link to="/admin/pages/new">
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("adminEvents.studio.pages.createPage")}
            </Link>
          </Button>
        </div>

        {rootPageId === null ? (
          <p className="rounded-md border border-dashed border-border p-4 text-[13px] text-muted-foreground">
            {t("adminEvents.studio.pages.noRootPageLong")}
          </p>
        ) : (
          <Tabs defaultValue="menu" className="space-y-3">
            <TabsList className="tabs-scroller">
              <TabsTrigger value="menu">
                {t("adminEvents.studio.pages.menuPages")} ({split.menu.length})
              </TabsTrigger>
              <TabsTrigger value="other">
                {t("adminEvents.studio.pages.otherPages")} ({split.other.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="menu">
              <PageList
                rows={split.menu}
                titleOf={titleOf}
                emptyKey="adminEvents.studio.pages.menuEmpty"
              />
            </TabsContent>
            <TabsContent value="other">
              <PageList
                rows={split.other}
                titleOf={titleOf}
                emptyKey="adminEvents.studio.pages.otherEmpty"
              />
            </TabsContent>
          </Tabs>
        )}

        <p className="text-xs text-muted-foreground">{t("adminEvents.studio.pages.menuMapping")}</p>
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
    </EventStudioPage>
  );
}

function PageList({
  rows,
  titleOf,
  emptyKey,
}: {
  rows: readonly EventPageRow[];
  titleOf: (row: EventPageRow) => string;
  emptyKey: string;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-[13px] text-muted-foreground">
        {t(emptyKey)}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((page) => (
        <li key={page.id} className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{titleOf(page)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{page.status}</span>
          <Button asChild variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <Link to="/admin/pages/$slug" params={{ slug: page.slug }} aria-label={titleOf(page)}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
