// Autosuggest pod polem frazy: cztery premium sekcje (Tytuły, Rodzaje treści,
// Tematyka, Osoby i organizacje) - ten sam podział co widget wyszukiwarki
// w nagłówku. Prezentacyjny - rodzic steruje zapytaniem i klawiaturą
// (combobox/listbox + aria-activedescendant), ten komponent tylko renderuje.
import { useTranslation } from "react-i18next";
import { FileText, LayoutGrid, Tags, Users } from "@/lib/lucide-shim";
import type { AutosuggestItem } from "@/lib/queries/archives";
import {
  suggestBucketOf,
  SUGGEST_BUCKET_LABELS,
  AUTOSUGGEST_LISTBOX_ID,
  autosuggestOptionId,
  type SuggestBucket,
} from "@/lib/search/facetModel";

interface Props {
  items: AutosuggestItem[]; // już uporządkowane przez orderSuggestions
  activeIndex: number;
  lang: "pl" | "en";
  onPick: (item: AutosuggestItem) => void;
}

const BUCKET_ICON: Record<SuggestBucket, typeof FileText> = {
  titles: FileText,
  contentTypes: LayoutGrid,
  topics: Tags,
  peopleOrg: Users,
};

export function SearchAutosuggest({ items, activeIndex, lang, onPick }: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  const label = (it: AutosuggestItem) =>
    (lang === "en" ? it.label_en || it.label_pl : it.label_pl || it.label_en) || "";

  let lastBucket: SuggestBucket | null = null;

  return (
    <ul
      id={AUTOSUGGEST_LISTBOX_ID}
      role="listbox"
      aria-label={t("search.title")}
      className="absolute z-30 mt-2 w-full max-h-[26rem] overflow-auto rounded-xl border border-border bg-popover shadow-lg py-1"
    >
      {items.map((it, i) => {
        const bucket = suggestBucketOf(it.kind);
        const Icon = BUCKET_ICON[bucket];
        const header =
          bucket !== lastBucket ? (
            <li
              key={`h-${bucket}`}
              role="presentation"
              className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/60 first:border-t-0"
            >
              <Icon className="w-3 h-3" aria-hidden />
              {SUGGEST_BUCKET_LABELS[lang][bucket]}
            </li>
          ) : null;
        lastBucket = bucket;
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
              className={`mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                active ? "bg-brand/10 text-brand-ink" : "hover:bg-muted"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{label(it)}</span>
            </li>
          </div>
        );
      })}
    </ul>
  );
}
