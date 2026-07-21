// Publiczny renderer BlocksDoc. SSR-friendly, czysto prezentacyjny.
//
// Architektura (atomic design): ten plik to cienki "template" - waliduje
// dokument, uruchamia pre-pass przypisów, ustanawia granicę tenanta i mapuje
// bloki na dyspozytora `BlockView`, opakowując każdy w granicę renderu. Cała
// logika typów bloków żyje w ./renderer (atoms / molecules / organisms +
// rejestr). Dzięki temu dodanie bloku to jeden wpis w rejestrze, a nie edycja
// wielkiego `switch`.

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BlocksDoc } from "@/lib/blocks/types";
import "@/lib/i18n-public";
import { FootnoteTooltips } from "@/components/Footnotes";
import type { Footnote } from "@/lib/footnotes";
import { safeParseBlocks } from "@/lib/blocks/schema";
import { RenderErrorBoundary } from "@/components/admin/builder/ui/organisms/widget-view/RenderErrorBoundary";
import {
  BlockView,
  BlocksTenantProvider,
  precomputeFootnotes,
  renderFootnoteHtml,
  type FootnoteCollector,
} from "./renderer";

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
  if (!doc?.blocks?.length) return null;
  const safe = safeParseBlocks(doc);
  if (!safe.blocks.length) return null;
  // Pre-pass: zbierz przypisy (i przekształcony HTML) PRZED renderem, żeby
  // sekcja przypisów była znana od pierwszego malowania / w SSR. Wcześniej
  // kolektor był mutowany podczas renderu dziecka, więc rodzic widział
  // `fn.notes.length === 0` i sekcja nigdy się nie pojawiała.
  const fn: FootnoteCollector = { notes: [] };
  const fnHtml = new Map<string, string>();
  precomputeFootnotes(safe.blocks, fn, fnHtml);
  const tooltipNotes: Footnote[] = fn.notes.map((html, i) => ({ id: i + 1, html }));
  const L = { title: t("blocksUi.footnotesTitle"), back: t("blocksUi.footnotesBack") };
  return (
    <BlocksTenantProvider host={tenantHost}>
      <article
        ref={articleRef}
        className="blocks-content prose prose-lg dark:prose-invert max-w-none"
        lang={lang}
        data-tenant-scope={tenantHost ?? undefined}
      >
        {safe.blocks.map((b) => {
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
                    allBlocks={safe.blocks}
                  />
                </div>
              ) : (
                <BlockView
                  block={b}
                  fnHtml={fnHtml}
                  lang={lang}
                  postId={postId}
                  allBlocks={safe.blocks}
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
              {fn.notes.map((n, i) => (
                <li key={i} id={`fn-${i + 1}`}>
                  <span data-fn-marker className="sr-only">
                    [{i + 1}]
                  </span>
                  <span dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(n) }} />{" "}
                  <a
                    href={`#fnref-${i + 1}`}
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
      </article>
    </BlocksTenantProvider>
  );
}
