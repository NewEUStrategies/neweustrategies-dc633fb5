// Widget "Speakers" - premium siatka prelegentów w stylu "mentors-section":
// portret 4:3 z overlay-bookmark (zapamiętywany w localStorage per tenant),
// filtry kategorii jako pigułki z accentem, opcjonalna wyszukiwarka i
// sortowanie, paginacja "load more" lub infinite scroll. Renderer jest w pełni
// deterministyczny podczas SSR (bookmarki hydratują dopiero po mount), używa
// tokenów Theme Design i wspiera dark/light. Kompatybilny z istniejącym
// SpeakersEditor - żadne pole danych nie zostało zmienione.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import {
  Star,
  User as UserIcon,
  Search as SearchIcon,
  Bookmark as BookmarkIcon,
} from "@/lib/lucide-shim";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import { getStr, type Lang } from "./frame";

type SpeakerItem = Record<string, unknown>;
type SortKey = "default" | "rating" | "gigs" | "reviews";

const ALL_KEY = "__all__";
const BOOKMARK_STORAGE_KEY = "cms:speakers:bookmarks";

function loc(item: SpeakerItem, base: string, lang: Lang): string {
  const v =
    (item[`${base}_${lang}`] as unknown) ??
    (item[`${base}_pl`] as unknown) ??
    (item[`${base}_en`] as unknown) ??
    item[base];
  return typeof v === "string" ? v : "";
}

function numOf(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function StarRow({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <span aria-hidden className="inline-flex items-center gap-[2px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={
            "h-3 w-3 " +
            (i < rounded
              ? "fill-[color:var(--speakers-accent)] text-[color:var(--speakers-accent)]"
              : "text-muted-foreground/30")
          }
        />
      ))}
    </span>
  );
}

export function SpeakersWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const c = (node.content ?? {}) as WidgetContent;
  const cRaw = c as unknown as Record<string, unknown>;

  const heading = loc(cRaw, "heading", lang);
  const columnsRaw = numOf(cRaw.columns, 3);
  const columns = Math.min(4, Math.max(2, Math.round(columnsRaw))) as 2 | 3 | 4;
  const accent = getStr(c, "accentColor") || "var(--brand)";

  const enableSearch = cRaw.enableSearch !== false;
  const enableSort = cRaw.enableSort !== false;
  const pageSize = Math.max(0, Math.round(numOf(cRaw.pageSize, 0)));
  const pageModeRaw = typeof cRaw.pageMode === "string" ? cRaw.pageMode : "button";
  const pageMode: "button" | "scroll" = pageModeRaw === "scroll" ? "scroll" : "button";

  const speakers: SpeakerItem[] = Array.isArray(cRaw.speakers)
    ? (cRaw.speakers as unknown[]).filter(
        (x): x is SpeakerItem => typeof x === "object" && x !== null && !Array.isArray(x),
      )
    : [];

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of speakers) {
      const cat = loc(s, "category", lang).trim();
      if (!cat || seen.has(cat)) continue;
      seen.add(cat);
      out.push(cat);
    }
    return out;
  }, [speakers, lang]);

  const [active, setActive] = useState<string>(ALL_KEY);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [visibleCount, setVisibleCount] = useState<number>(pageSize > 0 ? pageSize : 0);
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set());

  // Hydrate bookmarks after mount to keep SSR output deterministic.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setBookmarks(new Set(parsed.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* corrupted storage - ignore */
    }
  }, []);

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* quota/private mode - ignore */
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = speakers.filter((s) => {
      if (active !== ALL_KEY && loc(s, "category", lang).trim() !== active) return false;
      if (!q) return true;
      const hay = [
        getStr(s as WidgetContent, "name"),
        loc(s, "role", lang),
        loc(s, "description", lang),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    if (sort !== "default") {
      const key = sort;
      list = list.slice().sort((a, b) => numOf(b[key]) - numOf(a[key]));
    }
    return list;
  }, [speakers, active, query, sort, lang]);

  const paginated = useMemo(() => {
    if (pageSize <= 0 || visibleCount <= 0) return filtered;
    return filtered.slice(0, visibleCount);
  }, [filtered, pageSize, visibleCount]);

  const canLoadMore = pageSize > 0 && paginated.length < filtered.length;

  const gridClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  const accentStyle: CSSProperties = { ["--speakers-accent" as string]: accent };
  const allLabel = lang === "pl" ? "Wszyscy" : "All";

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "default", label: lang === "pl" ? "Kolejność" : "Default" },
    { value: "rating", label: lang === "pl" ? "Najlepsza ocena" : "Top rated" },
    { value: "gigs", label: lang === "pl" ? "Najwięcej wystąpień" : "Most gigs" },
    { value: "reviews", label: lang === "pl" ? "Najwięcej opinii" : "Most reviews" },
  ];

  const resetPagination = () => setVisibleCount(pageSize > 0 ? pageSize : 0);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pageMode !== "scroll" || !canLoadMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          setVisibleCount((n) => n + (pageSize > 0 ? pageSize : filtered.length));
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageMode, canLoadMore, pageSize, filtered.length]);

  return (
    <section className="cms-speakers space-y-6" style={accentStyle}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {heading ? (
          <h2 className="cms-block-heading text-foreground tracking-tight">{heading}</h2>
        ) : (
          <span />
        )}
        {(categories.length > 0 || speakers.length > 0) && (
          <div
            role="tablist"
            aria-label={lang === "pl" ? "Filtruj prelegentów" : "Filter speakers"}
            className="flex flex-wrap gap-1.5"
          >
            <FilterChip
              active={active === ALL_KEY}
              onClick={() => {
                setActive(ALL_KEY);
                resetPagination();
              }}
              label={allLabel}
            />
            {categories.map((cat) => (
              <FilterChip
                key={cat}
                active={active === cat}
                onClick={() => {
                  setActive(cat);
                  resetPagination();
                }}
                label={cat}
              />
            ))}
          </div>
        )}
      </header>

      {(enableSearch || enableSort) && speakers.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {enableSearch && (
            <label className="relative flex-1">
              <span className="sr-only">{lang === "pl" ? "Szukaj" : "Search"}</span>
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetPagination();
                }}
                placeholder={
                  lang === "pl"
                    ? "Szukaj po imieniu, roli, opisie…"
                    : "Search by name, role, description…"
                }
                className="h-10 w-full rounded-[6px] border border-border/60 bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/50"
              />
            </label>
          )}
          {enableSort && (
            <label className="flex items-center gap-2">
              <span className="cms-meta text-muted-foreground">
                {lang === "pl" ? "Sortuj:" : "Sort:"}
              </span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  resetPagination();
                }}
                className="h-10 rounded-[6px] border border-border/60 bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/50"
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div
        key={`${active}-${sort}-${query}`}
        className={`grid animate-in fade-in-0 slide-in-from-bottom-1 duration-300 grid-cols-1 ${gridClass} gap-4 sm:gap-5`}
      >
        {paginated.map((s, i) => {
          const id = (s.id as string) ?? `sp-${i}`;
          return (
            <SpeakerCard
              key={id}
              item={s}
              lang={lang}
              bookmarked={bookmarks.has(id)}
              onToggleBookmark={() => toggleBookmark(id)}
            />
          );
        })}
        {paginated.length === 0 && (
          <p className="cms-meta col-span-full text-center italic text-muted-foreground">
            {query
              ? lang === "pl"
                ? "Brak wyników wyszukiwania."
                : "No results."
              : lang === "pl"
                ? "Brak prelegentów w tej kategorii."
                : "No speakers in this category."}
          </p>
        )}
      </div>

      {canLoadMore && pageMode === "button" && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + (pageSize > 0 ? pageSize : filtered.length))}
            className="rounded-[6px] border border-border/70 bg-background px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[color:var(--speakers-accent)]/10 hover:border-[color:var(--speakers-accent)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/50"
          >
            {lang === "pl" ? "Pokaż więcej" : "Load more"}
            <span className="ml-2 text-xs text-muted-foreground">
              ({paginated.length}/{filtered.length})
            </span>
          </button>
        </div>
      )}
      {canLoadMore && pageMode === "scroll" && (
        <div
          ref={sentinelRef}
          aria-hidden
          className="h-10 w-full flex items-center justify-center text-xs text-muted-foreground"
        >
          <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="ml-2">
            {lang === "pl" ? "Wczytywanie…" : "Loading…"} ({paginated.length}/{filtered.length})
          </span>
        </div>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-[6px] px-3.5 py-1.5 text-xs font-medium transition-all duration-200 " +
        (active
          ? "bg-[color:var(--speakers-accent)] text-white shadow-sm shadow-[color:var(--speakers-accent)]/25 scale-[1.02]"
          : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

function SpeakerCard({
  item,
  lang,
  bookmarked,
  onToggleBookmark,
}: {
  item: SpeakerItem;
  lang: Lang;
  bookmarked: boolean;
  onToggleBookmark: () => void;
}) {
  const photo = safeImageUrl(
    getStr(item as WidgetContent, "photo") || getStr(item as WidgetContent, "image"),
  );
  const name = getStr(item as WidgetContent, "name");
  const role = loc(item, "role", lang);
  const description = loc(item, "description", lang);
  const gigs = numOf(item.gigs);
  const rating = numOf(item.rating);
  const reviews = numOf(item.reviews);
  const rawHref = getStr(item as WidgetContent, "href");
  const href = rawHref ? safeUrl(rawHref, "") : "";

  const bookmarkLabel = bookmarked
    ? lang === "pl"
      ? "Usuń z zakładek"
      : "Remove bookmark"
    : lang === "pl"
      ? "Dodaj do zakładek"
      : "Add bookmark";

  const bookmarkBtn = (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleBookmark();
      }}
      aria-label={bookmarkLabel}
      aria-pressed={bookmarked}
      title={bookmarkLabel}
      className={
        "absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 " +
        (bookmarked
          ? "bg-[color:var(--speakers-accent)] text-white shadow-md"
          : "bg-background/80 text-foreground/80 hover:bg-background hover:text-[color:var(--speakers-accent)]")
      }
    >
      <BookmarkIcon
        className={"h-4 w-4 " + (bookmarked ? "fill-current" : "")}
        aria-hidden
      />
    </button>
  );

  const body = (
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-[12px] border border-border/60 bg-card text-card-foreground shadow-sm transition-all duration-300 " +
        (href
          ? "hover:-translate-y-1 hover:shadow-lg hover:shadow-[color:var(--speakers-accent)]/10 hover:border-[color:var(--speakers-accent)]/40"
          : "")
      }
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {photo ? (
          <OptimizedImage
            src={photo}
            alt={name || ""}
            responsive
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-muted-foreground/40"
          >
            <UserIcon className="h-12 w-12" />
          </span>
        )}
        {bookmarkBtn}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {name && (
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">{name}</h3>
        )}
        {(role || gigs > 0) && (
          <p className="cms-meta">
            {role}
            {role && gigs > 0 ? " · " : ""}
            {gigs > 0 ? `${gigs} ${lang === "pl" ? "wystąpień" : "gigs"}` : ""}
          </p>
        )}
        {(rating > 0 || reviews > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rating > 0 && (
              <span className="font-semibold text-foreground">{rating.toFixed(1)}</span>
            )}
            <StarRow rating={rating} />
            {reviews > 0 && (
              <span>
                ({reviews} {lang === "pl" ? "opinii" : "reviews"})
              </span>
            )}
          </div>
        )}
        {description && (
          <p className="cms-meta mt-1 line-clamp-3 text-muted-foreground">{description}</p>
        )}
      </div>
    </article>
  );

  if (href) {
    return (
      <AppLink
        href={href}
        className="block h-full rounded-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/60"
        aria-label={name || undefined}
      >
        {body}
      </AppLink>
    );
  }
  return body;
}
