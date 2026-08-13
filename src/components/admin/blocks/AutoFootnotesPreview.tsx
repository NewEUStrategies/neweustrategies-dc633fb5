// Podgląd automatycznych przypisów źródłowych - EDYTOWALNY.
//
// Ten sam silnik (`collectFootnoteOrigins`), którego używa reszta aplikacji,
// zwraca listę przypisów w kolejności dokumentowej wraz z origin-em pozwalającym
// wskazać dokładne N-te wystąpienie `[fn]…[/fn]` w konkretnym polu bloku.
// Kliknięcie „Edytuj" pokazuje textarea; „Zapisz" wywołuje `onChange` z nowym
// dokumentem (immutable), którego zmiana natychmiast trafia do formularza edytora
// wpisu - autor nie musi wracać do treści, żeby doprecyzować przypis.
//
// Kontrakt zapisu:
// - pusta treść (po trim) usuwa marker (spójne z silnikiem, który puste dropuje);
// - identyczne treści są rozróżnialne po `occurrence`, więc edycja jednego nie
//   przecieka na inne.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Check, X, Trash2, AlertTriangle } from "lucide-react";
import type { BlocksDoc } from "@/lib/blocks/types";
import { safeParseBlocks } from "@/lib/blocks/schema";
import { renderFootnoteHtml } from "@/components/blocks/renderer";
import {
  collectFootnoteOrigins,
  updateFootnoteAtOrigin,
  type FootnoteEntry,
} from "@/lib/blocks/footnoteOrigins";
import { validateFootnotes, type FootnoteIssue } from "@/lib/blocks/footnoteValidation";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import "@/lib/i18n-public";

interface Props {
  doc: BlocksDoc | null | undefined;
  onChange?: (next: BlocksDoc) => void;
}

export function AutoFootnotesPreview({ doc, onChange }: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const entries: FootnoteEntry[] = useMemo(() => {
    if (!doc?.blocks?.length) return [];
    const safe = safeParseBlocks(doc);
    if (!safe.blocks.length) return [];
    return collectFootnoteOrigins({ ...doc, blocks: safe.blocks } as BlocksDoc);
  }, [doc]);

  const issues: FootnoteIssue[] = useMemo(() => {
    if (!doc?.blocks?.length) return [];
    const safe = safeParseBlocks(doc);
    if (!safe.blocks.length) return [];
    return validateFootnotes({ ...doc, blocks: safe.blocks } as BlocksDoc);
  }, [doc]);

  if (entries.length === 0 && issues.length === 0) return null;

  const canEdit = typeof onChange === "function";

  // Rozwiązuje id top-level bloku z pierwszego segmentu `origin.path`
  // (walidator/collector wchodzą do dokumentu z prefiksem `[]`, więc path[0]
  // to zawsze indeks w `doc.blocks`). Nawet dla przypisów zagnieżdżonych
  // wewnątrz columns/group scrollujemy do NAJBLIŻSZEGO renderowanego
  // top-level bloku - to jest jedyny poziom, który `SortableBlockItem`
  // oznacza atrybutem `data-block-id`.
  const scrollToOrigin = (path: readonly (string | number)[]) => {
    if (typeof document === "undefined") return;
    const topIdx = typeof path[0] === "number" ? (path[0] as number) : -1;
    const top = topIdx >= 0 ? doc?.blocks?.[topIdx] : null;
    if (!top?.id) return;
    const el = document.querySelector<HTMLElement>(`[data-block-id="${top.id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Krótki flash, żeby autor od razu widział, do którego bloku trafił.
    el.classList.add("ring-2", "ring-primary/70", "ring-offset-2", "rounded");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary/70", "ring-offset-2", "rounded");
    }, 1400);
  };

  const startEdit = (e: FootnoteEntry) => {
    setEditingId(e.id);
    setDraft(e.html);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };
  const saveEdit = (e: FootnoteEntry) => {
    if (!onChange || !doc) return;
    const next = updateFootnoteAtOrigin(doc, e.origin, draft);
    onChange(next);
    cancelEdit();
  };
  const removeEntry = (e: FootnoteEntry) => {
    if (!onChange || !doc) return;
    const next = updateFootnoteAtOrigin(doc, e.origin, "");
    onChange(next);
    if (editingId === e.id) cancelEdit();
  };

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
          title={t("admin.autoFootnotes.hint")}
        >
          {t("admin.autoFootnotes.badge")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("admin.autoFootnotes.count", { count: entries.length })}
        </span>
        {canEdit ? (
          <span className="ml-auto text-[10px] text-muted-foreground/80">
            {t("admin.autoFootnotes.editableHint")}
          </span>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <div
          role="alert"
          className="mb-3 rounded border border-amber-400/60 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-100"
        >
          <div className="flex items-center gap-1.5 font-semibold mb-1">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t("admin.autoFootnotes.warningsTitle", { count: issues.length })}
          </div>
          <ul className="space-y-1 pl-5 list-disc">
            {issues.map((iss, idx) => (
              <li key={`${iss.kind}:${iss.path.join("/")}:${idx}`}>
                <button
                  type="button"
                  onClick={() => scrollToOrigin(iss.path)}
                  className="font-medium underline decoration-dotted underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
                  title={t("admin.autoFootnotes.jumpToBlock")}
                >
                  {t("admin.autoFootnotes.blockLabel", {
                    n: iss.blockIndex + 1,
                    type: iss.blockType,
                  })}
                </button>
                : {iss.message}
                {iss.excerpt ? (
                  <code className="ml-1 rounded bg-amber-100/70 dark:bg-amber-900/40 px-1 py-0.5 text-[11px]">
                    {iss.excerpt}
                  </code>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entries.length === 0 ? null : (
        <ol className="space-y-1.5 pl-5 list-decimal text-sm text-foreground/85">
          {entries.map((e) => {
            const isEditing = editingId === e.id;
            return (
              <li
                key={`${e.id}:${e.origin.path.join("/")}:${e.origin.occurrence}`}
                id={`fn-preview-${e.id}`}
                className="group"
              >
                {isEditing ? (
                  <div className="flex flex-col gap-1.5 py-1">
                    <Textarea
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
                          ev.preventDefault();
                          saveEdit(e);
                        } else if (ev.key === "Escape") {
                          ev.preventDefault();
                          cancelEdit();
                        }
                      }}
                      autoFocus
                      rows={2}
                      className="text-sm"
                      aria-label={t("admin.autoFootnotes.editLabel", { n: e.id })}
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEdit(e)}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90"
                      >
                        <Check className="h-3 w-3" />
                        {t("common.save", { defaultValue: "Zapisz" })}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-3 w-3" />
                        {t("common.cancel", { defaultValue: "Anuluj" })}
                      </button>
                      <span className="text-[10px] text-muted-foreground/70 ml-auto">
                        {t("admin.autoFootnotes.hotkey")}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={cn("flex items-start gap-2")}>
                    <button
                      type="button"
                      onClick={() => scrollToOrigin(e.origin.path)}
                      className="flex-1 text-left rounded hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40 px-1 -mx-1"
                      title={t("admin.autoFootnotes.jumpHint")}
                      aria-label={t("admin.autoFootnotes.jumpAria", { n: e.id })}
                    >
                      <span dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(e.html) }} />
                    </button>
                    {canEdit ? (
                      <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          title={t("common.edit")}
                          aria-label={t("admin.autoFootnotes.editLabel", { n: e.id })}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEntry(e)}
                          title={t("common.delete", { defaultValue: "Usuń" })}
                          aria-label={t("admin.autoFootnotes.removeLabel", { n: e.id })}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
