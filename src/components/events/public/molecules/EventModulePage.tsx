// Molekuła: POWIERZCHNIA ZAKŁADKI MODUŁOWEJ - wstęp redagowany w studiu, a pod
// nim dane z bazy.
//
// PO CO WSTĘP JEST Z CMS-a, A NIE Z KODU. Pięć podstron modułowych to
// PRAWDZIWE strony w tabeli `pages`, przypięte do wydarzenia przez
// `event_pages.module` i zasiewane razem z dokumentem buildera: nagłówek `h1`
// i jedno zdanie wprowadzenia (migracja 20260826181500, funkcja
// `_event_module_page_document`). Gdyby zakładka rysowała własny nagłówek
// wpisany w kod, redaktor edytowałby w studiu tekst, którego nikt nigdy nie
// zobaczy - a strona, którą tam widzi, byłaby czymś innym niż strona, którą
// widzi uczestnik.
//
// JEDEN RENDERER, NIE DRUGI. Dokument jedzie DOKŁADNIE tą samą drogą, co każda
// inna strona serwisu: `resolvedContentQueryOptions` (ten sam klucz cache, co
// trasa splat `src/routes/$.tsx`) -> `prepareContentForRender` ->
// `ContentRenderer`. Przepisanie tu „małego renderera nagłówka i akapitu”
// dałoby drugi rysunek tej samej treści i pierwszy widget wstawiony przez
// redakcję (obraz, przycisk, kolumny) przestałby się pojawiać. Precedens dla
// tego wzorca stoi w `src/routes/support.tsx`.
//
// ŚCIEŻKI NIE SKŁADAMY - BIERZEMY JĄ Z `event_menu`. RPC oddaje pełną ścieżkę
// strony (rekurencyjnie z łańcucha slugów rodziców) razem ze znacznikiem
// `module`, więc dopasowanie „która z pozycji jest agendą” jest porównaniem
// jednej kolumny, a nie zgadywaniem po sluggu, który redakcja może zmienić.
//
// BRAK WSTĘPU NIE JEST AWARIĄ ZAKŁADKI. Strona modułowa może być odpięta,
// cofnięta do szkicu albo widoczna tylko dla wybranych grup - wtedy `event_menu`
// jej nie odda i wstępu po prostu nie ma. Dane pod spodem (lista uczestników,
// program, siatka prelegentów) mają własne źródło i własne bramki, więc
// zakładka nadal robi swoje. Zdanie „nie znaleźliśmy strony” byłoby tu
// nieprawdą o zakładce, która działa.
import type { ReactNode } from "react";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { eventModuleOf, type EventModule } from "@/lib/events/eventModules";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { publicEventBySlugQueryOptions } from "@/lib/community/publicQueries";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CalendarDays, Handshake, MessagesSquare, Mic, Users, LayoutGrid } from "@/lib/lucide-shim";
import type { ComponentType } from "react";
import { resolvedContentQueryOptions, type PageData } from "@/lib/queries/public";
import { EventPortalContent } from "@/components/events/public/atoms/EventPortalContent";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { hasRenderableBody } from "@/lib/access/gating";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";

export function EventModulePage({
  slug,
  module,
  children,
  contentClassName,
}: {
  /** Slug wydarzenia (parametr trasy). */
  slug: string;
  /** Który z pięciu modułów rysuje ta zakładka. */
  module: EventModule;
  /** Organizm z danymi - staje POD wstępem z CMS-a. */
  children: ReactNode;
  /** Nadpisuje miarę kolumny treści (np. szersza dla siatki prelegentów). */
  contentClassName?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  // Menu jest już w cache po pasku zakładek w powłoce (ten sam hook, ten sam
  // klucz), więc to nie jest drugie zapytanie.
  const menuQuery = useEventMenu(slug);
  const entry = (menuQuery.data ?? []).find((item) => eventModuleOf(item.module) === module);
  const segments = entry === undefined ? [] : entry.path.split("/").filter((part) => part !== "");

  // Zwykłe `useQuery`, nie suspense, i `retry: false`: brak dokumentu albo błąd
  // sieci ma zdegradować się do samych danych pod spodem, a nie wywrócić
  // zakładkę granicą błędu.
  const docQuery = useQuery({
    ...resolvedContentQueryOptions(segments),
    enabled: segments.length > 0,
    retry: false,
  });

  const page =
    docQuery.data && docQuery.data.kind === "page" ? (docQuery.data.item as PageData) : null;
  const hasDocument =
    page !== null &&
    hasRenderableBody({
      content_pl: page.content_pl,
      content_en: page.content_en,
      builder_data: page.builder_data,
      blocks_data: page.blocks_data ?? null,
    });

  const eventQuery = useQuery({ ...publicEventBySlugQueryOptions(slug), retry: false });
  const ev = eventQuery.data ?? null;
  const eventTitle =
    ev === null ? "" : lang === "en" ? ev.title_en || ev.title_pl : ev.title_pl || ev.title_en;
  const moduleLabel = entry
    ? lang === "en"
      ? entry.labelEn || entry.labelPl
      : entry.labelPl || entry.labelEn
    : t(`eventFront.header.tabs.${module}`);
  const crumbs = [
    { label: t("eventFront.header.breadcrumbEvents"), href: "/events" },
    ...(eventTitle ? [{ label: eventTitle, href: `/events/${slug}` }] : []),
    { label: moduleLabel },
  ];
  const Icon = MODULE_ICONS[module] ?? LayoutGrid;

  return (
    // Miara kolumny treści jest WSPÓLNA z przeglądem i z podglądem studia
    // (`EVENT_PORTAL_CONTENT_CLASS`): trzy kopie `max-w-5xl px-4 pt-8` już raz
    // się rozjechały - podgląd rysował `max-w-3xl`.
    <EventPortalContent className={contentClassName}>
      <Breadcrumbs items={crumbs} className="mb-5" />
      <header
        data-event-module-hero={module}
        className="relative mb-8 overflow-hidden rounded-[6px] border border-border bg-card p-6 sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/60 to-transparent"
        />
        <div className="relative flex items-start gap-4 sm:gap-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-primary sm:size-14">
            <Icon className="size-6 sm:size-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eventTitle || t("eventFront.header.moduleEyebrow")}
            </p>
            {hasDocument && page !== null ? (
              <div className="event-module-hero-doc [&_h1]:mb-2 [&_h1]:mt-0 [&_p:last-child]:mb-0 [&_p]:text-muted-foreground">
                <ModuleDocument page={page} lang={lang} />
              </div>
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {moduleLabel}
              </h1>
            )}
          </div>
        </div>
      </header>
      <div>{children}</div>
    </EventPortalContent>
  );
}

const MODULE_ICONS: Partial<Record<EventModule, ComponentType<{ className?: string }>>> = {
  participants: Users,
  speakers: Mic,
  partners: Handshake,
  agenda: CalendarDays,
  discussions: MessagesSquare,
};

/** Dokument strony modułowej - ta sama ścieżka renderowania, co `/$` i `/support`. */
function ModuleDocument({ page, lang }: { page: PageData; lang: "pl" | "en" }) {
  const blocksData = (page.blocks_data as LocalizedBlocks | null) ?? null;
  const blocksDoc: BlocksDoc | null = blocksData
    ? (blocksData[lang] ?? blocksData.pl ?? blocksData.en ?? null)
    : null;
  const prepared = prepareContentForRender({
    editor: page.editor,
    builderDoc: parseBuilderDoc(page.builder_data),
    blocksDoc,
    rawHtml:
      (lang === "en" ? page.content_en || page.content_pl : page.content_pl || page.content_en) ??
      "",
    lang,
  });

  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={contentRef} data-cms-content>
      <FootnoteTooltips notes={prepared.footnotes} containerRef={contentRef} />
      <ContentRenderer
        editor={page.editor}
        builderDoc={prepared.builderDoc}
        blocksDoc={prepared.blocksDoc}
        html={prepared.html}
        lang={lang}
      />
      <FootnotesList notes={prepared.footnotes} lang={lang} />
    </div>
  );
}
