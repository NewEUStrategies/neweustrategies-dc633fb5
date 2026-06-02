import { useState } from "react";
import { BLOCK_LIST, IMPLEMENTED_BLOCKS, type BlockSpec } from "@/lib/blocks/registry";
import type { Block } from "@/lib/blocks/types";
import { Plus, X } from "@/lib/lucide-shim";

interface Props {
  onInsert: (block: Block) => void;
  /** "inline" = pływający przycisk między blokami; "fab" = duży placeholder. */
  variant?: "inline" | "fab";
}

export function BlockInserter({ onInsert, variant = "inline" }: Props) {
  const [open, setOpen] = useState(false);

  const choose = (spec: BlockSpec) => {
    onInsert(spec.create());
    setOpen(false);
  };

  const categories: Array<{ id: BlockSpec["category"]; label: string }> = [
    { id: "text", label: "Tekst" },
    { id: "media", label: "Media" },
    { id: "layout", label: "Layout" },
    { id: "advanced", label: "Zaawansowane" },
  ];

  if (!open) {
    return variant === "fab" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border-2 border-dashed border-border py-8 text-muted-foreground hover:border-primary hover:text-primary transition flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> Dodaj pierwszy blok
      </button>
    ) : (
      <div className="relative group h-2 -my-1">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center opacity-0 group-hover:opacity-100 transition">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-primary text-primary-foreground w-5 h-5 flex items-center justify-center shadow"
            aria-label="Dodaj blok"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 my-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dodaj blok</h4>
        <button type="button" onClick={() => setOpen(false)} className="p-1 hover:bg-accent rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {categories.map((cat) => {
        const items = BLOCK_LIST.filter((b) => b.category === cat.id);
        if (!items.length) return null;
        return (
          <div key={cat.id} className="mb-3 last:mb-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{cat.label}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((spec) => {
                const Icon = spec.icon;
                const impl = IMPLEMENTED_BLOCKS.includes(spec.type);
                return (
                  <button
                    key={spec.type}
                    type="button"
                    onClick={() => choose(spec)}
                    disabled={!impl}
                    title={impl ? spec.description : `${spec.description} (wkrótce)`}
                    className="flex flex-col items-center gap-1 p-2 rounded border border-border hover:border-primary hover:bg-accent text-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[11px] leading-tight">{spec.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
