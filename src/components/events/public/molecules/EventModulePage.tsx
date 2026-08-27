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
}: {
  /** Slug wydarzenia (parametr trasy). */
  slug: string;
  /** Który z pięciu modułów rysuje ta zakładka. */
  module: EventModule;
  /** Organizm z danymi - staje POD wstępem z CMS-a. */
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
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

  return (
    // Miara kolumny treści jest WSPÓLNA z przeglądem i z podglądem studia
    // (`EVENT_PORTAL_CONTENT_CLASS`): trzy kopie `max-w-5xl px-4 pt-8` już raz
    // się rozjechały - podgląd rysował `max-w-3xl`.
    <EventPortalContent>
      {hasDocument && page !== null && <ModuleDocument page={page} lang={lang} />}
      <div className={hasDocument ? "mt-8" : undefined}>{children}</div>
    </EventPortalContent>
  );
}

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
