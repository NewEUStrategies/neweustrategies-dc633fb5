// Autosuggest pod polem frazy na stronie /search. Renderuje IDENTYCZNY
// mega-box jak widget nagłówkowy (SearchButtonWidget): pasek zakładek,
// grupowana lista wierszy, stopka operatorów, wiersz „zobacz wszystkie".
// Rodzic steruje frazą, klawiaturą i nawigacją (combobox/listbox +
// aria-activedescendant); tu tylko render + lokalny stan zakładki.
import { useMemo, useState, type RefObject } from "react";
import i18n from "@/lib/i18n";
import {
  ArrowRight,
  Clock,
  FileText,
  LayoutGrid,
  Search as SearchIcon,
  SlidersHorizontal,
  Tags,
  Users,
} from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
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
import { useAuthorAvatars } from "@/lib/search/useAuthorAvatars";

interface Props {
  items: AutosuggestItem[];
  activeIndex: number;
  lang: "pl" | "en";
  onPick: (item: AutosuggestItem) => void;
  /** Aktualna fraza - potrzebna do stopki (view all + operatory). */
  query?: string;
  /** Ref inputa - potrzebny, żeby wstawianie operatorów przywracało fokus. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Wstawienie operatora do inputa (kontrolowany input rodzica). */
  onSetQuery?: (next: string, caretPos: number) => void;
  /** Wywoływane po kliknięciu „zobacz wszystkie wyniki". */
  onSubmitPhrase?: (phrase: string) => void;
  /** Ścieżka do zaawansowanego wyszukiwania (rzadko nadpisywana). */
  advHref?: string;
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

type TabKey = "all" | SuggestBucket;

export function SearchAutosuggest({
  items,
  activeIndex,
  lang,
  onPick,
  query = "",
  inputRef,
  onSetQuery,
  onSubmitPhrase,
  advHref,
}: Props) {
  const [tab, setTab] = useState<TabKey>("all");
  const authorAvatars = useAuthorAvatars(items);

  const grouped = useMemo(() => {
    const g = new Map<SuggestBucket, BucketedItem[]>();
    for (const b of SUGGEST_BUCKET_ORDER) g.set(b, []);
    for (const it of items) {
      const b = suggestBucketOf(it.kind);
      g.get(b)!.push({ item: it, bucket: b, index: 0 });
    }
    let idx = 0;
    for (const b of SUGGEST_BUCKET_ORDER) {
      for (const entry of g.get(b)!) entry.index = idx++;
    }
    return g;
  }, [items]);

  if (items.length === 0) return null;

  const label = (it: AutosuggestItem) =>
    (lang === "en" ? it.label_en || it.label_pl : it.label_pl || it.label_en) || "";
  const kindLabel = (k: AutosuggestItem["kind"]) =>
    i18n.t(`search.widget.kind.${k}`, { lng: lang, defaultValue: "" }) as string;
  const t = (k: string, fb: string) =>
    (i18n.t(`search.widget.${k}`, { lng: lang, defaultValue: fb }) as string) || fb;
  const bucketLabel = (b: SuggestBucket) => SUGGEST_BUCKET_LABELS[lang][b];

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const showChrome = hasQuery && (onSubmitPhrase || onSetQuery);
  const searchAllHref = `/search?q=${encodeURIComponent(trimmed)}`;
  const resolvedAdvHref = advHref ?? (hasQuery ? `${searchAllHref}&adv=1` : "/search?adv=1");

  const OPERATORS: Array<{ op: string; ins: string; caret?: number }> = [
    { op: '"fraza"', ins: '"" ', caret: 1 },
    { op: "AND", ins: " AND " },
    { op: "OR", ins: " OR " },
    { op: "NOT", ins: " NOT " },
    { op: t("operator_word", "-słowo"), ins: " -" },
  ];

  return (
    <SuggestListShell className="absolute left-0 right-0 top-full z-50 mt-2 animate-in fade-in-0 slide-in-from-top-1">
      {/* ============= Pasek zakładek (jak w widgecie mega-box) ============= */}
      {hasQuery && (
        <div
          role="tablist"
          aria-label={t("categories", "Kategorie")}
          className="flex items-center gap-1 border-b border-border/60 bg-muted/30 px-2.5 py-1.5"
        >
          {(["all", ...SUGGEST_BUCKET_ORDER] as const).map((k) => {
            const count =
              k === "all" ? items.length : (grouped.get(k as SuggestBucket)?.length ?? 0);
            if (k !== "all" && count === 0) return null;
            const isActive = tab === k;
            const tLabel = k === "all" ? t("all", "Wszystko") : bucketLabel(k as SuggestBucket);
            return (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setTab(k);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium leading-none transition-all ${
                  isActive
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                {tLabel}
                <span
                  className={`inline-flex min-w-[14px] items-center justify-center rounded px-1 text-[8px] font-semibold tabular-nums ${
                    isActive
                      ? "bg-[color-mix(in_oklab,var(--brand)_16%,transparent)] text-[var(--brand-ink)]"
                      : "bg-muted/60 text-muted-foreground/80"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="max-h-[26rem] overflow-y-auto">
        <ul
          id={AUTOSUGGEST_LISTBOX_ID}
          role="listbox"
          aria-label={i18n.t("search.title", { lng: lang, defaultValue: "Szukaj" }) as string}
          className="py-1"
        >
          {SUGGEST_BUCKET_ORDER.map((bucket) => {
            if (tab !== "all" && tab !== bucket) return null;
            const entries = grouped.get(bucket) ?? [];
            if (entries.length === 0) return null;
            const Icon = BUCKET_ICON[bucket];
            return (
              <li key={bucket} role="presentation" className="pb-1">
                <SuggestGroupHeader
                  icon={Icon}
                  label={bucketLabel(bucket)}
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
                          avatarUrl={it.kind === "author" && it.id ? authorAvatars[it.id] ?? null : null}
                          active={i === activeIndex}
                          onMouseDown={(e) => {
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

        {/* „Zobacz wszystkie wyniki" - jak w widgecie. */}
        {showChrome && onSubmitPhrase && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSubmitPhrase(trimmed);
            }}
            className="group flex w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[10px] font-semibold leading-none transition-colors hover:bg-[color-mix(in_oklab,var(--brand)_6%,transparent)]"
            style={{ color: "var(--brand)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <SearchIcon className="h-3 w-3" aria-hidden />
              {t("view_all", "Zobacz wszystkie wyniki dla")}
              <span className="font-bold">„{trimmed}"</span>
            </span>
            <ArrowRight
              className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        )}
      </div>

      {/* Stopka: operatory + skróty + zaawansowane wyszukiwanie. */}
      {showChrome && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/60 bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("operators", "Operatory")}
            </span>
            {OPERATORS.map(({ op, ins, caret }) => (
              <button
                key={op}
                type="button"
                title={t("operator_insert", "Wstaw operator")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const el = inputRef?.current;
                  if (!el || !onSetQuery) return;
                  const start = el.selectionStart ?? query.length;
                  const end = el.selectionEnd ?? query.length;
                  const next = query.slice(0, start) + ins + query.slice(end);
                  const pos = start + (caret ?? ins.length);
                  onSetQuery(next, pos);
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(pos, pos);
                  });
                }}
                className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[8px] font-semibold leading-[1.4] text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-all hover:-translate-y-px hover:border-[var(--brand)] hover:text-[var(--brand)]"
              >
                {op}
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-2 text-[8px] text-muted-foreground md:flex">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">↑</kbd>
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">↓</kbd>
              {t("kbd_navigate", "nawiguj")}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">↵</kbd>
              {t("kbd_select", "wybierz")}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[8px] leading-none text-foreground/80">esc</kbd>
              {t("kbd_close", "zamknij")}
            </span>
          </div>
          <AppLink
            href={resolvedAdvHref}
            className="inline-flex items-center gap-1 text-[9px] font-semibold hover:underline"
            style={{ color: "var(--brand)" }}
          >
            <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden />
            {t("advanced", "Zaawansowane")}
          </AppLink>
        </div>
      )}
    </SuggestListShell>
  );
}

// Wspólny wiersz dla „Ostatnich wyszukiwań" (empty state) w rich stylu.
// Używane na /search zamiast starych pill-chipów, żeby popover empty i
// popover z wynikami wyglądały identycznie.
export function RecentSearchesList({
  items,
  lang,
  onPick,
  onClear,
}: {
  items: string[];
  lang: "pl" | "en";
  onPick: (term: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const t = (k: string, fb: string) =>
    (i18n.t(`search.${k}`, { lng: lang, defaultValue: fb }) as string) || fb;
  return (
    <SuggestListShell className="w-full">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" aria-hidden />
          {t("recent", "Ostatnie wyszukiwania")}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[9px] font-medium text-muted-foreground transition-colors hover:text-[var(--brand)]"
        >
          {t("recent_clear", "Wyczyść historię")}
        </button>
      </div>
      <ul role="list" className="py-1">
        {items.map((term) => (
          <li key={term} role="presentation">
            <SuggestRow
              href={`/search?q=${encodeURIComponent(term)}`}
              label={term}
              icon={Clock}
              active={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(term);
              }}
            />
          </li>
        ))}
      </ul>
    </SuggestListShell>
  );
}
