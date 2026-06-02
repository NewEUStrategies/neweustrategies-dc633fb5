// Document Outline - quick navigation through headings & block sequence.
// Atomic molecule; relies on `data-block-id` markers rendered by SortableBlockItem.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { htmlToPlain } from "@/lib/blocks/markdown";
import { BLOCK_SPECS } from "@/lib/blocks/registry";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  onSelect: (id: string) => void;
}

interface Entry {
  id: string;
  label: string;
  level: number;
  kind: "heading" | "other";
  type: Block["type"];
}

function deriveLabel(block: Block): string {
  const html = typeof block.data.html === "string" ? block.data.html : "";
  if (html) {
    const plain = htmlToPlain(html).trim();
    if (plain) return plain.length > 60 ? plain.slice(0, 60) + "..." : plain;
  }
  const label = typeof block.data.label === "string" ? block.data.label : "";
  if (label) return label;
  const alt = typeof block.data.alt === "string" ? block.data.alt : "";
  if (alt) return alt;
  const url = typeof block.data.url === "string" ? block.data.url : "";
  if (url) return url.replace(/^https?:\/\//, "").slice(0, 50);
  return "";
}

export function DocumentOutline({ doc, activeId, onSelect }: Props) {
  const { t } = useTranslation();

  const entries = useMemo<Entry[]>(() => {
    return doc.blocks.map((b) => {
      const level = b.type === "heading" && typeof b.data.level === "number" ? b.data.level : 0;
      return {
        id: b.id,
        label: deriveLabel(b) || BLOCK_SPECS[b.type].label,
        level,
        kind: b.type === "heading" ? "heading" : "other",
        type: b.type,
      };
    });
  }, [doc.blocks]);

  const headings = entries.filter((e) => e.kind === "heading");

  const handleSelect = (id: string) => {
    onSelect(id);
    if (typeof document !== "undefined") {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("blocks.outline.title")}
      </h4>
      {headings.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          {t("blocks.outline.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {headings.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => handleSelect(h.id)}
                className={`w-full text-left text-xs px-2 py-1 rounded truncate transition-colors ${
                  h.id === activeId
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-accent text-foreground/80"
                }`}
                style={{ paddingLeft: `${0.5 + Math.max(0, h.level - 2) * 0.75}rem` }}
                title={h.label}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
