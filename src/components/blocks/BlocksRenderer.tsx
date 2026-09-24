// Publiczny renderer BlocksDoc. SSR-friendly, czysto prezentacyjny.
//
// Architektura (atomic design): ten plik to cienki "template" - waliduje
// dokument, uruchamia pre-pass przypisów, ustanawia granicę tenanta i mapuje
// bloki na dyspozytora `BlockView`, opakowując każdy w granicę renderu. Cała
// logika typów bloków żyje w ./renderer (atoms / molecules / organisms +
// rejestr). Dzięki temu dodanie bloku to jeden wpis w rejestrze, a nie edycja
// wielkiego `switch`.

import { lazy, Suspense, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BlocksDoc } from "@/lib/blocks/types";
import "@/lib/i18n-public";
import { FootnoteTooltips } from "@/components/Footnotes";
import { createCounter, isLegacyFootnoteReferenceHtml, type Footnote } from "@/lib/footnotes";
import { safeParseBlocks } from "@/lib/blocks/schema";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";
import { readInlineEntities, referencedInlineEntities } from "@/lib/blocks/inlineEntities/registry";
import {
  BlockView,
  BlocksTenantProvider,
  precomputeFootnotes,
  renderFootnoteHtml,
  type FootnoteCollector,
} from "./renderer";

// Karty encji inline (firma / osoba) - osobny, leniwy chunk ładowany tylko dla
// artykułów, które mają encje w treści. Na SSR komponent i tak nic nie
// renderuje (znaczniki są statycznym HTML-em z pre-passu), więc leniwość nie
// zmienia ani bajtu dokumentu, a pozostałe artykuły nie płacą za niego nic.
const InlineEntityCards = lazy(() => import("./inlineEntities/InlineEntityCards"));

interface Props {
  doc: BlocksDoc | null | undefined;
  lang?: "pl" | "en";
  /** Wymagane do bloków typu `liveblog` (subskrypcja realtime per post). */
  postId?: string;
  /**
   * Jawny host tenanta dla granicy izolacji (patrz renderer/tenant.tsx). Pomiń,
   * aby pozostać w zakresie otoczeniowym: tenant wynika wtedy z hosta żądania
   * (nagłówek `x-tenant-host` + RLS `tenant_id = public_tenant_id()`). Podana
   * wartość musi być identyczna na serwerze i kliencie, by nie zaburzyć
   * hydratacji.
   */
  tenantHost?: string | null;
}

export function BlocksRenderer({ doc, lang = "pl", postId, tenantHost }: Props) {
  const { t } = useTranslation();
  const articleRef = useRef<HTMLElement | null>(null);
  // Validation and footnotes depend on document content, not language/context
  // rerenders. This cache belongs to this renderer, never to another request.
  const { contentBlocks, fn, fnHtml, hasBlocks, inlineEntities } = useMemo(() => {
    const safe = safeParseBlocks(doc);
    const contentBlocks = safe.blocks.filter(
      (block) => !(block.type === "html" && isLegacyFootnoteReferenceHtml(block.data.html)),
    );
    const fn: FootnoteCollector = createCounter(1);
    const fnHtml = new Map<string, string>();
    // Rejestr encji inline żyje w `doc.meta` - dane są częścią materiału, więc
    // SSR ma je bez żadnego zapytania do bazy. Czytamy go z dokumentu
    // wejściowego, nie z `safe`: degradacja schematu świadomie gubi `meta`,
    // a rejestr ma własną walidację (`normalizeInlineEntityRegistry`), więc
    // jeden wadliwy blok nie odbiera encji blokom poprawnym.
    const registry = readInlineEntities(doc);
    precomputeFootnotes(contentBlocks, fn, fnHtml, registry);
    const inlineEntities = referencedInlineEntities(contentBlocks, registry);
    return { contentBlocks, fn, fnHtml, hasBlocks: safe.blocks.length > 0, inlineEntities };
  }, [doc]);
  if (!hasBlocks) return null;
  const tooltipNotes: Footnote[] = fn.notes;
  const L = { title: t("blocksUi.footnotesTitle"), back: t("blocksUi.footnotesBack") };
  return (
    <BlocksTenantProvider host={tenantHost}>
      <article
        ref={articleRef}
        className="blocks-content cms-rich-content prose prose-lg dark:prose-invert min-w-0 w-full max-w-full"
        lang={lang}
        data-tenant-scope={tenantHost ?? undefined}
      >
        {contentBlocks.map((b) => {
          // Flaga widoczności z inspektora bloku: ukryte bloki znikają z publikacji
          // (nadal edytowalne w kanwie admina).
          if (b.style?.hidden) return null;
          // Honorujemy nadpisania odstępów (marginTop/marginBottom). Opakowujemy
          // TYLKO gdy margines jest ustawiony, żeby nietknięta większość zachowała
          // naturalne odstępy prose oraz wyrównanie wide/full.
          const mt = b.style?.marginTop;
          const mb = b.style?.marginBottom;
          const spacing =
            mt != null || mb != null
              ? {
                  marginTop: mt != null ? `${mt}px` : undefined,
                  marginBottom: mb != null ? `${mb}px` : undefined,
                }
              : undefined;
          // Izolacja per blok, jak granica per-widget w builderze: jeden wadliwy
          // blok degraduje się do niczego (prod) / diagnostyki (dev) zamiast
          // wywalać cały artykuł przez globalną granicę.
          return (
            <RenderErrorBoundary key={b.id} label={`block:${b.type}:${b.id}`}>
              {spacing ? (
                <div style={spacing}>
                  <BlockView
                    block={b}
                    fnHtml={fnHtml}
                    lang={lang}
                    postId={postId}
                    allBlocks={contentBlocks}
                  />
                </div>
              ) : (
                <BlockView
                  block={b}
                  fnHtml={fnHtml}
                  lang={lang}
                  postId={postId}
                  allBlocks={contentBlocks}
                />
              )}
            </RenderErrorBoundary>
          );
        })}
        {fn.notes.length > 0 && (
          <section
            className="footnotes mt-10 pt-6 border-t border-border text-sm"
            aria-labelledby="footnotes-heading"
          >
            <h2
              id="footnotes-heading"
              data-footnotes-title
              className="text-base font-semibold mb-3"
            >
              {L.title}
            </h2>
            <ol data-footnotes-list className="space-y-2 pl-5 list-decimal">
              {fn.notes.map((n) => (
                <li key={n.id} id={`fn-${n.id}`}>
                  <span data-fn-marker className="sr-only">
                    [{n.id}]
                  </span>
                  <span dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(n.html) }} />{" "}
                  <a
                    href={`#fnref-${n.id}`}
                    data-footnote-backlink
                    className="text-muted-foreground hover:text-primary"
                    aria-label={L.back}
                    title={L.back}
                  >
                    ↩
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
        {tooltipNotes.length > 0 && (
          <FootnoteTooltips notes={tooltipNotes} containerRef={articleRef} />
        )}
        {inlineEntities.length > 0 && (
          <Suspense fallback={null}>
            <InlineEntityCards entities={inlineEntities} lang={lang} containerRef={articleRef} />
          </Suspense>
        )}
      </article>
    </BlocksTenantProvider>
  );
}
