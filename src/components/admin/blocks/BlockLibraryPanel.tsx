// Lewy panel biblioteki bloków w stylu Gutenberga.
// - przeszukiwanie po nazwie/typie/opisie
// - grupowanie po kategoriach (text/media/layout/advanced)
// - kliknięcie wstawia blok na koniec dokumentu
// - obsługa Esc / X do zamknięcia
// - lokalizacja PL/EN przez i18next

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_LIST, IMPLEMENTED_BLOCKS, type BlockSpec } from "@/lib/blocks/registry";
import type { Block, BlockType } from "@/lib/blocks/types";
import { X } from "@/lib/lucide-shim";

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (block: Block) => void;
}

export function BlockLibraryPanel({ open, onClose, onInsert }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const labelFor = (type: BlockType): string => t(`blocks.types.${type}`);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BLOCK_LIST;
    return BLOCK_LIST.filter(
      (s) =>
        labelFor(s.type).toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t]);

  const choose = (spec: BlockSpec) => {
    onInsert(spec.create());
  };

  const categories: Array<{ id: BlockSpec["category"]; label: string }> = [
    { id: "text", label: t("blocks.categories.text") },
    { id: "media", label: t("blocks.categories.media") },
    { id: "layout", label: t("blocks.categories.layout") },
    { id: "advanced", label: t("blocks.categories.advanced") },
  ];

  if (!open) return null;

  return (
    <aside
      aria-label={t("blocks.library")}
      className="bg-card border border-border rounded-lg flex flex-col max-h-[calc(100vh-2rem)] lg:sticky lg:top-4 self-start"
    >
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border">
        <h3 className="text-sm font-semibold">{t("blocks.library")}</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-accent rounded"
          aria-label={t("common.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-3 border-b border-border">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) {
              e.preventDefault();
              choose(filtered[0]);
            }
          }}
          placeholder={t("blocks.search")}
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">
            {t("blocks.noResults")}
          </p>
        ) : query.trim() ? (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((spec) => renderItem(spec, labelFor, choose))}
          </div>
        ) : (
          categories.map((cat) => {
            const items = filtered.filter((b) => b.category === cat.id);
            if (!items.length) return null;
            return (
              <div key={cat.id} className="mb-4 last:mb-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {cat.label}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((spec) => renderItem(spec, labelFor, choose))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function renderItem(
  spec: BlockSpec,
  labelFor: (t: BlockType) => string,
  choose: (s: BlockSpec) => void,
) {
  const Icon = spec.icon;
  const impl = IMPLEMENTED_BLOCKS.includes(spec.type);
  return (
    <button
      key={spec.type}
      type="button"
      onClick={() => choose(spec)}
      disabled={!impl}
      title={spec.description}
      className="flex flex-col items-center gap-1 p-2 rounded border border-border hover:border-primary hover:bg-accent text-center disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon className="w-4 h-4" />
      <span className="text-[11px] leading-tight">{labelFor(spec.type)}</span>
    </button>
  );
}
