// Autosuggest pod polem frazy: publikacje, autorzy i termy taksonomii
// (w tym państwa). Prezentacyjny - rodzic steruje zapytaniem i klawiaturą
// (combobox/listbox + aria-activedescendant), ten komponent tylko renderuje.
import { useTranslation } from "react-i18next";
import { FileText, User, Tags } from "@/lib/lucide-shim";
import type { AutosuggestItem } from "@/lib/queries/archives";
import { suggestGroup, AUTOSUGGEST_LISTBOX_ID, autosuggestOptionId } from "@/lib/search/facetModel";

interface Props {
  items: AutosuggestItem[]; // już uporządkowane przez orderSuggestions
  activeIndex: number;
  lang: "pl" | "en";
  onPick: (item: AutosuggestItem) => void;
}

export function SearchAutosuggest({ items, activeIndex, lang, onPick }: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  const label = (it: AutosuggestItem) =>
    (lang === "en" ? it.label_en || it.label_pl : it.label_pl || it.label_en) || "";

  let lastGroup: ReturnType<typeof suggestGroup> | null = null;

  return (
    <ul
      id={AUTOSUGGEST_LISTBOX_ID}
      role="listbox"
      aria-label={t("search.title")}
      className="absolute z-30 mt-1 w-full max-h-[22rem] overflow-auto rounded-lg border border-border bg-popover shadow-lg py-1"
    >
      {items.map((it, i) => {
        const g = suggestGroup(it);
        const header =
          g !== lastGroup ? (
            <li
              key={`h-${g}`}
              role="presentation"
              className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {t(`search.suggest.${g}`)}
            </li>
          ) : null;
        lastGroup = g;
        const Icon = g === "posts" ? FileText : g === "authors" ? User : Tags;
        const active = i === activeIndex;
        return (
          <div key={`${it.kind}:${it.id ?? it.slug ?? i}`}>
            {header}
            <li
              id={autosuggestOptionId(i)}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => {
                // mousedown (nie click) - wyprzedza blur pola i nie gubi wyboru.
                e.preventDefault();
                onPick(it);
              }}
              className={`mx-1 flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer ${
                active ? "bg-brand/10 text-brand-ink" : "hover:bg-muted"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label(it)}</span>
            </li>
          </div>
        );
      })}
    </ul>
  );
}
