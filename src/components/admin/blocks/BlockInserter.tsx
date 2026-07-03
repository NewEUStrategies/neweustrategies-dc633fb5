// Inserter z wyszukiwarką (command palette UX), grupowaniem po kategoriach
// oraz wsparciem dla wariantu "fab" (puste) i "inline" (między blokami).
// Wspiera tryb "open by default" do użycia jako slash-menu.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_LIST, IMPLEMENTED_BLOCKS, type BlockSpec } from "@/lib/blocks/registry";
import type { Block, BlockType } from "@/lib/blocks/types";
import { Plus, X } from "@/lib/lucide-shim";

interface Props {
  onInsert: (block: Block) => void;
  variant?: "inline" | "fab" | "controlled";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  autoFocus?: boolean;
}

export function BlockInserter({
  onInsert,
  variant = "inline",
  open: openProp,
  onOpenChange,
  autoFocus = false,
}: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && autoFocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open) setQuery("");
  }, [open, autoFocus]);

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
    setOpen(false);
  };

  const categories: Array<{ id: BlockSpec["category"]; label: string }> = [
    { id: "text", label: t("blocks.categories.text") },
    { id: "media", label: t("blocks.categories.media") },
    { id: "layout", label: t("blocks.categories.layout") },
    { id: "advanced", label: t("blocks.categories.advanced") },
  ];

  if (!open) {
    if (variant === "controlled") return null;
    return variant === "fab" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border-2 border-dashed border-border py-8 text-muted-foreground hover:border-primary hover:text-primary transition flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> {t("blocks.firstBlock")}
      </button>
    ) : (
      <div className="relative group h-2 -my-0.5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center opacity-0 group-hover:opacity-100 transition">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-primary text-primary-foreground w-5 h-5 flex items-center justify-center shadow"
            aria-label={t("blocks.addBlock")}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 my-2 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
            if (e.key === "Enter" && filtered[0]) {
              e.preventDefault();
              choose(filtered[0]);
            }
          }}
          placeholder={t("blocks.search")}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="p-1 hover:bg-accent rounded"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-3 text-center">
          {t("blocks.noResults")}
        </p>
      ) : query.trim() ? (
        <div className="grid grid-cols-3 gap-1.5">
          {filtered.map((spec) => renderItem(spec, labelFor, choose))}
        </div>
      ) : (
        categories.map((cat) => {
          const items = filtered.filter((b) => b.category === cat.id);
          if (!items.length) return null;
          return (
            <div key={cat.id} className="mb-3 last:mb-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                {cat.label}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((spec) => renderItem(spec, labelFor, choose))}
              </div>
            </div>
          );
        })
      )}
    </div>
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
