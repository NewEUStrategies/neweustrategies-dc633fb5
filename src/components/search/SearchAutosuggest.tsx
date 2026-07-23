// Autosuggest pod polem frazy na stronie /search. Renderuje TĘ SAMĄ listę
// grupowaną co widget nagłówkowy (ten sam bucket model, te same wiersze),
// żeby wyszukiwanie na obu powierzchniach wyglądało identycznie.
// Prezentacyjny - rodzic steruje zapytaniem, klawiaturą i nawigacją
// (combobox/listbox + aria-activedescendant); tu tylko render.
import { useMemo } from "react";
import i18n from "@/lib/i18n";
import { FileText, LayoutGrid, Tags, Users } from "@/lib/lucide-shim";
import type { AutosuggestItem } from "@/lib/queries/archives";
import {
  suggestBucketOf,
  suggestionHref,
  SUGGEST_BUCKET_ORDER,
  SUGGEST_BUCKET_LABELS,
  AUTOSUGGEST_LISTBOX_ID,
  autosuggestOptionId,
  type SuggestBucket,
} from "@/lib/search/facetModel";
import { SuggestGroupHeader, SuggestRow, SuggestListShell } from "./SuggestListView";

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

interface BucketedItem {
  item: AutosuggestItem;
  bucket: SuggestBucket;
  index: number;
}

export function SearchAutosuggest({ items, activeIndex, lang, onPick }: Props) {
  const grouped = useMemo(() => {
    const g = new Map<SuggestBucket, BucketedItem[]>();
    for (const b of SUGGEST_BUCKET_ORDER) g.set(b, []);
    for (const it of items) {
      g.get(suggestBucketOf(it.kind))!.push({ item: it, bucket: suggestBucketOf(it.kind), index: 0 });
    }
    let idx = 0;
    for (const b of SUGGEST_BUCKET_ORDER) {
      for (const entry of g.get(b)!) {
        entry.index = idx++;
      }
    }
    return g;
  }, [items]);

  if (items.length === 0) return null;

  const label = (it: AutosuggestItem) =>
    (lang === "en" ? it.label_en || it.label_pl : it.label_pl || it.label_en) || "";
  const kindLabel = (k: AutosuggestItem["kind"]) =>
    i18n.t(`search.widget.kind.${k}`, { lng: lang, defaultValue: "" }) as string;

  return (
    <SuggestListShell className="absolute left-0 right-0 top-full z-50 mt-2 animate-in fade-in-0 slide-in-from-top-1">
      <ul
        id={AUTOSUGGEST_LISTBOX_ID}
        role="listbox"
        aria-label={i18n.t("search.title", { lng: lang, defaultValue: "Szukaj" }) as string}
        className="max-h-[26rem] overflow-auto py-1"
      >
        {SUGGEST_BUCKET_ORDER.map((bucket) => {
          const entries = grouped.get(bucket) ?? [];
          if (entries.length === 0) return null;
          const Icon = BUCKET_ICON[bucket];
          return (
            <li key={bucket} role="presentation" className="pb-1">
              <SuggestGroupHeader
                icon={Icon}
                label={SUGGEST_BUCKET_LABELS[lang][bucket]}
                count={entries.length}
              />
              <ul role="presentation">
                {entries.map((entry) => {
                  const it = entry.item;
                  const i = entry.index;
                  return (
                    <li key={`${it.kind}:${it.id ?? it.slug ?? i}`} role="presentation">
                      <SuggestRow
                        id={autosuggestOptionId(i)}
                        href={suggestionHref(it)}
                        label={label(it)}
                        meta={kindLabel(it.kind)}
                        icon={Icon}
                        active={i === activeIndex}
                        onMouseDown={(e) => {
                          // mousedown wyprzedza blur inputa; rodzic (routes/search)
                          // sam nawiguje przez pickSuggestion, więc blokujemy link.
                          e.preventDefault();
                          onPick(it);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </SuggestListShell>
  );
}
