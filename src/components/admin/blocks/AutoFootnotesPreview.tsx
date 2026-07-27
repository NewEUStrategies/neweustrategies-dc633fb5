// Podgląd automatycznych przypisów źródłowych w kanwie admina.
//
// Odpalamy TEN SAM silnik (`precomputeFootnotes` + `createCounter`), który
// budują publiczny `BlocksRenderer`, żeby autor widział w edytorze dokładnie
// tę listę, która pojawi się na froncie po wpisaniu `[fn]…[/fn]` w treści.
// Nic tu nie modyfikuje dokumentu - kolektor działa na kopii i jest odrzucany.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { BlocksDoc } from "@/lib/blocks/types";
import { safeParseBlocks } from "@/lib/blocks/schema";
import { createCounter, type Footnote } from "@/lib/footnotes";
import { precomputeFootnotes, renderFootnoteHtml } from "@/components/blocks/renderer";
import "@/lib/i18n-public";

interface Props {
  doc: BlocksDoc | null | undefined;
}

export function AutoFootnotesPreview({ doc }: Props) {
  const { t } = useTranslation();
  const notes: Footnote[] = useMemo(() => {
    if (!doc?.blocks?.length) return [];
    const safe = safeParseBlocks(doc);
    if (!safe.blocks.length) return [];
    const fn = createCounter(1);
    precomputeFootnotes(safe.blocks, fn, new Map());
    return fn.notes;
  }, [doc]);

  if (notes.length === 0) return null;

  return (
    <section
      className="mt-8 pt-4 border-t border-dashed border-border/70"
      aria-label={t("blocksUi.footnotesTitle", { defaultValue: "Przypisy źródłowe" })}
    >
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground/90">
          {t("blocksUi.footnotesTitle", { defaultValue: "Przypisy źródłowe" })}
        </h3>
        <span
          className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded"
          title={t("admin.autoFootnotes.hint", {
            defaultValue: "Zbierane automatycznie z [fn]…[/fn] w treści.",
          })}
        >
          {t("admin.autoFootnotes.badge", { defaultValue: "auto z [fn]…[/fn]" })}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("admin.autoFootnotes.count", {
            defaultValue: "{{count}} przypis(y)",
            count: notes.length,
          })}
        </span>
      </div>
      <ol className="space-y-1.5 pl-5 list-decimal text-sm text-foreground/85">
        {notes.map((n) => (
          <li key={n.id} id={`fn-preview-${n.id}`}>
            <span dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(n.html) }} />
          </li>
        ))}
      </ol>
    </section>
  );
}
