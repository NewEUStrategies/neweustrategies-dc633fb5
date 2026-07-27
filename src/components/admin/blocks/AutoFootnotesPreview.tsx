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
import {
  validateFootnotes,
  type FootnoteIssue,
} from "@/lib/blocks/footnoteValidation";
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

  if (entries.length === 0) return null;

  const canEdit = typeof onChange === "function";

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
          title={t("admin.autoFootnotes.hint", {
            defaultValue: "Zbierane automatycznie z [fn]…[/fn] w treści.",
          })}
        >
          {t("admin.autoFootnotes.badge", { defaultValue: "auto z [fn]…[/fn]" })}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("admin.autoFootnotes.count", {
            defaultValue: "{{count}} przypis(y)",
            count: entries.length,
          })}
        </span>
        {canEdit ? (
          <span className="ml-auto text-[10px] text-muted-foreground/80">
            {t("admin.autoFootnotes.editableHint", {
              defaultValue: "Kliknij ikonę ołówka, aby edytować - zmiany trafiają do treści.",
            })}
          </span>
        ) : null}
      </div>
      <ol className="space-y-1.5 pl-5 list-decimal text-sm text-foreground/85">
        {entries.map((e) => {
          const isEditing = editingId === e.id;
          return (
            <li key={`${e.id}:${e.origin.path.join("/")}:${e.origin.occurrence}`} id={`fn-preview-${e.id}`} className="group">
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
                    aria-label={t("admin.autoFootnotes.editLabel", {
                      defaultValue: "Treść przypisu nr {{n}}",
                      n: e.id,
                    })}
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
                      {t("admin.autoFootnotes.hotkey", { defaultValue: "⌘/Ctrl+Enter zapisuje" })}
                    </span>
                  </div>
                </div>
              ) : (
                <div className={cn("flex items-start gap-2", canEdit && "cursor-text")}>
                  <span
                    className="flex-1"
                    dangerouslySetInnerHTML={{ __html: renderFootnoteHtml(e.html) }}
                  />
                  {canEdit ? (
                    <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        title={t("common.edit", { defaultValue: "Edytuj" })}
                        aria-label={t("admin.autoFootnotes.editLabel", {
                          defaultValue: "Treść przypisu nr {{n}}",
                          n: e.id,
                        })}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(e)}
                        title={t("common.delete", { defaultValue: "Usuń" })}
                        aria-label={t("admin.autoFootnotes.removeLabel", {
                          defaultValue: "Usuń przypis nr {{n}}",
                          n: e.id,
                        })}
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
    </section>
  );
}
