// Menu slash 1:1 z WordPress Gutenberg: "/" pisze się DO akapitu, a lista
// pod karetką filtruje się dalszym tekstem ("/nag" -> Nagłówek). Nawigacja
// strzałkami/Enter jest routowana z TipTapa przez rodzica (Paragraph) -
// komponent jest czysto prezentacyjny, więc nie walczy o fokus z edytorem.

import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import type { BlockSpec } from "@/lib/blocks/registry";
import type { BlockType } from "@/lib/blocks/types";

interface Props {
  specs: readonly BlockSpec[];
  activeIndex: number;
  onPick: (spec: BlockSpec) => void;
  onHover: (index: number) => void;
}

export function SlashMenu({ specs, activeIndex, onPick, onHover }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const labelFor = (type: BlockType): string => t(`blocks.types.${type}`);

  // Aktywna pozycja zawsze w widoku listy.
  useEffect(() => {
    const spec = specs[activeIndex];
    if (!spec) return;
    document.getElementById(`${listId}-slash-${spec.type}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, specs, listId]);

  return (
    <div
      role="listbox"
      aria-label={t("blocks.inserter.resultsLabel")}
      className="absolute left-0 top-full z-50 mt-1 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {specs.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground italic">{t("blocks.noResults")}</p>
      ) : (
        specs.map((spec, i) => {
          const Icon = spec.icon;
          const active = i === activeIndex;
          return (
            <button
              key={spec.type}
              id={`${listId}-slash-${spec.type}`}
              type="button"
              role="option"
              aria-selected={active}
              // TipTap trzyma fokus w akapicie - mousedown nie może go kraść,
              // inaczej wybór z myszy zamykałby menu przed kliknięciem.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(spec)}
              onMouseEnter={() => onHover(i)}
              className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block leading-tight">{labelFor(spec.type)}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground truncate">
                  {spec.description}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
