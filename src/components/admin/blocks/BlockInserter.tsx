// Inserter z wyszukiwarką (command palette UX), grupowaniem po kategoriach
// oraz wsparciem dla wariantu "fab" (puste) i "inline" (między blokami).
// Wspiera tryb "open by default" do użycia jako slash-menu.
//
// Jak w WordPress Gutenberg otwarcie pokazuje najpierw SZYBKI panel
// (6 najczęściej używanych bloków + wyszukiwarka + „Przeglądaj wszystko"),
// a pełna biblioteka rozwija się na życzenie - z zakładkami Bloki | Wzorce
// (wzorce = gotowe kompozycje bloków, lib/blocks/patterns.ts).
//
// Dostępność: pełna nawigacja klawiaturą po siatce wyników (strzałki /
// Home / End / Enter), wzorzec combobox + listbox (`aria-activedescendant`),
// aktywna pozycja podświetlona i doscrollowana do widoku.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_SPECS, type BlockSpec } from "@/lib/blocks/registry";
import type { Block, BlockType } from "@/lib/blocks/types";
import { searchBlockSpecs } from "@/lib/blocks/search";
import {
  BLOCK_PATTERNS,
  filterPatterns,
  instantiatePattern,
  type BlockPattern,
} from "@/lib/blocks/patterns";
import { useBlockEditorLang } from "./BlockEditorContext";
import { Plus, X } from "@/lib/lucide-shim";

/** Odpowiednik „six most used" z szybkiego insertera WP. */
const QUICK_TYPES: readonly BlockType[] = [
  "paragraph",
  "heading",
  "image",
  "list",
  "quote",
  "separator",
];

/** Siatka wyników ma stałe 3 kolumny - strzałki góra/dół skaczą o wiersz. */
const GRID_COLUMNS = 3;

interface Props {
  onInsert: (block: Block) => void;
  /** Wstawienie WIELU bloków naraz (wzorce). Bez tego zakładka Wzorce jest ukryta. */
  onInsertBlocks?: (blocks: Block[]) => void;
  variant?: "inline" | "fab" | "controlled";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  autoFocus?: boolean;
}

export function BlockInserter({
  onInsert,
  onInsertBlocks,
  variant = "inline",
  open: openProp,
  onOpenChange,
  autoFocus = false,
}: Props) {
  const { t } = useTranslation();
  const docLang = useBlockEditorLang();
  const listboxId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"blocks" | "patterns">("blocks");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && autoFocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open) {
      setQuery("");
      setExpanded(false);
      setTab("blocks");
    }
  }, [open, autoFocus]);

  // Zmiana kontekstu wyników = powrót aktywnej pozycji na początek listy.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, expanded, open, tab]);

  const labelFor = (type: BlockType): string => t(`blocks.types.${type}`);
  const patternName = (p: BlockPattern): string => t(`blocks.patterns.items.${p.key}.name`);
  const patternDesc = (p: BlockPattern): string => t(`blocks.patterns.items.${p.key}.desc`);

  const filtered = useMemo(
    () => searchBlockSpecs(query, labelFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, t],
  );

  const patternsEnabled = Boolean(onInsertBlocks);
  const filteredPatterns = useMemo(
    () => filterPatterns(BLOCK_PATTERNS, query, patternName, patternDesc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, t],
  );

  const categories = useMemo(
    (): Array<{ id: BlockSpec["category"]; label: string }> => [
      { id: "text", label: t("blocks.categories.text") },
      { id: "media", label: t("blocks.categories.media") },
      { id: "layout", label: t("blocks.categories.layout") },
      { id: "dynamic", label: t("blocks.categories.dynamic") },
      { id: "widgets", label: t("blocks.categories.widgets") },
      { id: "forms", label: t("blocks.categories.forms") },
      { id: "marketing", label: t("blocks.categories.marketing") },
      { id: "data", label: t("blocks.categories.data") },
    ],
    [t],
  );

  // Płaska lista widocznych pozycji W KOLEJNOŚCI RENDEROWANIA - wspólny model
  // dla nawigacji strzałkami niezależnie od trybu (wyniki / szybki / pełny).
  const visibleSpecs = useMemo<BlockSpec[]>(() => {
    if (tab === "patterns") return [];
    if (query.trim()) return filtered;
    if (!expanded) return QUICK_TYPES.map((type) => BLOCK_SPECS[type]);
    return categories.flatMap((cat) => filtered.filter((b) => b.category === cat.id));
  }, [tab, query, filtered, expanded, categories]);

  const clampedIdx = Math.min(activeIdx, Math.max(visibleSpecs.length - 1, 0));
  const indexByType = useMemo(
    () => new Map(visibleSpecs.map((s, i) => [s.type, i])),
    [visibleSpecs],
  );
  const optionId = (type: BlockType): string => `${listboxId}-opt-${type}`;

  // Aktywna pozycja zawsze w widoku (pełna biblioteka przewija się).
  useEffect(() => {
    const spec = visibleSpecs[clampedIdx];
    if (!spec) return;
    document.getElementById(optionId(spec.type))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedIdx, visibleSpecs]);

  const choose = (spec: BlockSpec) => {
    onInsert(spec.create());
    setOpen(false);
  };

  const choosePattern = (pattern: BlockPattern) => {
    onInsertBlocks?.(instantiatePattern(pattern, docLang));
    setOpen(false);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (tab === "patterns") {
      if (e.key === "Enter" && filteredPatterns[0]) {
        e.preventDefault();
        choosePattern(filteredPatterns[0]);
      }
      return;
    }
    const max = visibleSpecs.length - 1;
    if (max < 0) return;
    const move = (delta: number) => {
      e.preventDefault();
      setActiveIdx(Math.min(Math.max(clampedIdx + delta, 0), max));
    };
    switch (e.key) {
      case "ArrowRight":
        move(1);
        return;
      case "ArrowLeft":
        move(-1);
        return;
      case "ArrowDown":
        move(GRID_COLUMNS);
        return;
      case "ArrowUp":
        move(-GRID_COLUMNS);
        return;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        return;
      case "End":
        e.preventDefault();
        setActiveIdx(max);
        return;
      case "Enter": {
        e.preventDefault();
        const spec = visibleSpecs[clampedIdx];
        if (spec) choose(spec);
        return;
      }
    }
  };

  const item = (spec: BlockSpec) => {
    const idx = indexByType.get(spec.type) ?? -1;
    return renderItem(spec, labelFor, choose, {
      id: optionId(spec.type),
      active: idx === clampedIdx,
      onActivate: () => setActiveIdx(idx),
    });
  };

  if (!open) {
    if (variant === "controlled") return null;
    return variant === "fab" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border-2 border-dashed border-border py-8 text-muted-foreground hover:border-foreground hover:text-foreground transition flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> {t("blocks.firstBlock")}
      </button>
    ) : (
      <div className="relative group h-2 -my-0.5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center opacity-0 group-hover:opacity-100 transition">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-foreground text-background w-5 h-5 flex items-center justify-center shadow"
            aria-label={t("blocks.addBlock")}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  const activeSpec = visibleSpecs[clampedIdx];
  const showTabs = patternsEnabled && (expanded || tab === "patterns");

  return (
    <div className="rounded-lg border border-border bg-card p-3 my-2 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={
            tab === "blocks" && activeSpec ? optionId(activeSpec.type) : undefined
          }
          placeholder={t("blocks.search")}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="p-1 hover:bg-accent rounded"
          aria-label={t("blocks.inserter.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {showTabs && (
        <div
          role="tablist"
          aria-label={t("blocks.inserter.tabsLabel")}
          className="flex items-center gap-1 mb-2 border-b border-border"
        >
          {(["blocks", "patterns"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {key === "blocks" ? t("blocks.inserter.tabBlocks") : t("blocks.inserter.tabPatterns")}
            </button>
          ))}
        </div>
      )}

      {tab === "patterns" ? (
        <div className="max-h-[26rem] overflow-y-auto pr-1 space-y-1.5">
          {filteredPatterns.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              {t("blocks.noResults")}
            </p>
          ) : (
            filteredPatterns.map((pattern) => {
              const Icon = BLOCK_SPECS[pattern.iconType].icon;
              return (
                <button
                  key={pattern.key}
                  type="button"
                  onClick={() => choosePattern(pattern)}
                  className="w-full flex items-start gap-2.5 rounded border border-border p-2.5 text-left hover:border-[#FDB078] hover:bg-[#FDB078]/20 transition-colors"
                >
                  <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{patternName(pattern)}</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">
                      {patternDesc(pattern)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <div id={listboxId} role="listbox" aria-label={t("blocks.inserter.resultsLabel")}>
          {visibleSpecs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              {t("blocks.noResults")}
            </p>
          ) : query.trim() ? (
            <div className="grid grid-cols-3 gap-1.5">{filtered.map(item)}</div>
          ) : !expanded ? (
            // Szybki panel jak w WP: najczęściej używane + „Przeglądaj wszystko".
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {QUICK_TYPES.map((type) => item(BLOCK_SPECS[type]))}
              </div>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="w-full mt-2 py-2 rounded bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t("blocks.inserter.browseAll")}
              </button>
            </>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto pr-1">
              {categories.map((cat) => {
                const items = filtered.filter((b) => b.category === cat.id);
                if (!items.length) return null;
                return (
                  <div key={cat.id} className="mb-3 last:mb-0" role="presentation">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      {cat.label}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">{items.map(item)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ItemOptions {
  id: string;
  active: boolean;
  onActivate: () => void;
}

function renderItem(
  spec: BlockSpec,
  labelFor: (t: BlockType) => string,
  choose: (s: BlockSpec) => void,
  opts: ItemOptions,
) {
  const Icon = spec.icon;
  return (
    <button
      key={spec.type}
      id={opts.id}
      type="button"
      role="option"
      aria-selected={opts.active}
      onClick={() => choose(spec)}
      onMouseEnter={opts.onActivate}
      title={spec.description}
      className={`flex flex-col items-center gap-1 p-2 rounded border text-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
        opts.active
          ? "border-[#FDB078] bg-[#FDB078]/20"
          : "border-border hover:border-[#FDB078] hover:bg-[#FDB078]/20"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="text-[11px] leading-tight">{labelFor(spec.type)}</span>
    </button>
  );
}
