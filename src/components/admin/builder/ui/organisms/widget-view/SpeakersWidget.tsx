// Widget "Speakers" - premium siatka prelegentów w stylu "mentors-section":
// portret 4:3 z overlay-bookmark (localStorage per widget, z migracją ze
// starego klucza globalnego), badge kategorii na zdjęciu, filtry-pigułki
// z licznikami, filtr "tylko zapisani", wyszukiwarka z podświetlaniem trafień,
// sortowanie, licznik wyników (aria-live), ułamkowe gwiazdki ocen, kaskadowe
// animacje wejścia kart oraz paginacja "load more" lub infinite scroll.
// Renderer jest deterministyczny podczas SSR (bookmarki hydratują po mount),
// używa tokenów Theme Design i wspiera dark/light. Kompatybilny z istniejącym
// SpeakersEditor - żadne pole danych nie zostało zmienione.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import {
  User as UserIcon,
  Search as SearchIcon,
  Bookmark as BookmarkIcon,
  ShieldCheck,
} from "@/lib/lucide-shim";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import {
  speakersQueryOptions,
  speakersSource,
  type PublicSpeakerRow,
} from "@/lib/builder/speakersQuery";
import { SpeakerStars } from "@/components/events/SpeakerStars";
import type { SpeakerDialogFallback } from "@/components/events/SpeakerProfileDialog";
import { getStr, type Lang } from "./frame";

// SpeakersWidget siedzi w EAGER-owej sciezce chrome (SimpleWidgets), a dialog
// profilu montuje sie dopiero po kliknieciu - lazy chunk trzyma Radix Dialog i
// zapytania profilu poza bundlem wejsciowym.
const SpeakerProfileDialogLazy = lazy(() =>
  import("@/components/events/SpeakerProfileDialog").then((m) => ({
    default: m.SpeakerProfileDialog,
  })),
);

type SpeakerItem = Record<string, unknown>;
type SortKey = "default" | "rating" | "gigs" | "reviews";

const ALL_KEY = "__all__";
const BOOKMARKED_KEY = "__bookmarked__";
const LEGACY_BOOKMARK_STORAGE_KEY = "cms:speakers:bookmarks";

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

// Podświetla pierwsze trafienie zapytania w tekście (case-insensitive).
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-[color:var(--speakers-accent)]/20 px-0.5 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** Wiersz z RPC -> kształt karty (ten sam, co wpisy ręczne), więc filtrowanie,
 *  sortowanie i paginacja działają identycznie dla każdego źródła. */
function speakerRowToItem(row: PublicSpeakerRow): SpeakerItem {
  const rolePl = row.headline_pl || row.job_title || "";
  const roleEn = row.headline_en || row.job_title || "";
  return {
    id: row.user_id,
    user_id: row.user_id,
    userId: row.user_id,
    photo: row.avatar_url ?? "",
    name: row.display_name ?? "",
    role_pl: rolePl,
    role_en: roleEn,
    category_pl: "",
    category_en: "",
    gigs: row.talks_count,
    rating: row.rating,
    reviews: row.reviews_count,
    description_pl: row.bio_pl ?? "",
    description_en: row.bio_en ?? "",
    href: row.slug ? `/author/${row.slug}` : "",
    isExpert: row.is_expert,
  };
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
  const source = speakersSource(c);
  const openProfile = cRaw.openProfile !== false;

  const manualSpeakers: SpeakerItem[] = useMemo(
    () =>
      Array.isArray(cRaw.speakers)
        ? (cRaw.speakers as unknown[]).filter(
            (x): x is SpeakerItem => typeof x === "object" && x !== null && !Array.isArray(x),
          )
        : [],
    [cRaw.speakers],
  );

  const dbQ = useQuery({
    ...speakersQueryOptions(c, lang),
    enabled: source !== "manual",
  });

  // Źródło danych: ręczne wpisy albo publiczna projekcja z RPC. Mapujemy
  // wiersz RPC na TEN SAM kształt karty, więc filtry, sortowanie i paginacja
  // działają identycznie niezależnie od źródła.
  const speakers: SpeakerItem[] = useMemo(
    () =>
      source === "manual" ? manualSpeakers : (dbQ.data ?? []).map((row) => speakerRowToItem(row)),
    [source, manualSpeakers, dbQ.data],
  );

  // Stabilne ID per pozycja (fallback po indeksie) - używane do bookmarków
  // i kluczy Reacta, liczone raz zamiast w każdym miejscu osobno.
  const entries = useMemo(
    () =>
      speakers.map((s, i) => ({
        item: s,
        id: typeof s.id === "string" && s.id ? s.id : `sp-${i}`,
      })),
    [speakers],
  );

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { item } of entries) {
      const cat = loc(item, "category", lang).trim();
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count }));
  }, [entries, lang]);

  const [active, setActive] = useState<string>(ALL_KEY);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [visibleCount, setVisibleCount] = useState<number>(pageSize > 0 ? pageSize : 0);
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set());
  const [dialogSpeaker, setDialogSpeaker] = useState<{
    userId: string;
    fallback?: SpeakerDialogFallback;
  } | null>(null);

  // Bookmarki są zapisywane per widget (node.id), żeby dwa widgety Speakers
  // na różnych stronach nie współdzieliły stanu. Stary klucz globalny jest
  // czytany jako fallback, żeby nie zgubić wcześniejszych zapisów.
  const storageKey = `cms:speakers:bookmarks:${node.id}`;

  // Hydrate bookmarks after mount to keep SSR output deterministic.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw =
        window.localStorage.getItem(storageKey) ??
        window.localStorage.getItem(LEGACY_BOOKMARK_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setBookmarks(new Set(parsed.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* corrupted storage - ignore */
    }
  }, [storageKey]);

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* quota/private mode - ignore */
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter(({ item, id }) => {
      if (active === BOOKMARKED_KEY) {
        if (!bookmarks.has(id)) return false;
      } else if (active !== ALL_KEY && loc(item, "category", lang).trim() !== active) {
        return false;
      }
      if (!q) return true;
      const hay = [
        getStr(item as WidgetContent, "name"),
        loc(item, "role", lang),
        loc(item, "description", lang),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    if (sort !== "default") {
      const key = sort;
      list = list.slice().sort((a, b) => numOf(b.item[key]) - numOf(a.item[key]));
    }
    return list;
  }, [entries, active, query, sort, lang, bookmarks]);

  const paginated = useMemo(() => {
    if (pageSize <= 0 || visibleCount <= 0) return filtered;
    return filtered.slice(0, visibleCount);
  }, [filtered, pageSize, visibleCount]);

  const canLoadMore = pageSize > 0 && paginated.length < filtered.length;
  const hasActiveFilters = active !== ALL_KEY || query.trim() !== "" || sort !== "default";

  const gridClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  const accentStyle: CSSProperties = { ["--speakers-accent" as string]: accent };
  const allLabel = lang === "pl" ? "Wszyscy" : "All";
  const bookmarkedLabel = lang === "pl" ? "Zapisani" : "Saved";

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "default", label: lang === "pl" ? "Kolejność" : "Default" },
    { value: "rating", label: lang === "pl" ? "Najlepsza ocena" : "Top rated" },
    { value: "gigs", label: lang === "pl" ? "Najwięcej wystąpień" : "Most gigs" },
    { value: "reviews", label: lang === "pl" ? "Najwięcej opinii" : "Most reviews" },
  ];

  const resetPagination = () => setVisibleCount(pageSize > 0 ? pageSize : 0);
  const clearFilters = () => {
    setActive(ALL_KEY);
    setQuery("");
    setSort("default");
    resetPagination();
  };

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pageMode !== "scroll" || !canLoadMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (observed) => {
        if (observed.some((x) => x.isIntersecting)) {
          setVisibleCount((n) => n + (pageSize > 0 ? pageSize : filtered.length));
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageMode, canLoadMore, pageSize, filtered.length]);


  const onOpenProfile = (item: SpeakerItem) => {
    if (!openProfile) return;
    const userId = getStr(item as WidgetContent, "user_id");
    if (!userId) return;
    setDialogSpeaker({
      userId,
      fallback: {
        name: getStr(item as WidgetContent, "name") || undefined,
        role: loc(item, "role", lang) || undefined,
        photo:
          safeImageUrl(
            getStr(item as WidgetContent, "photo") || getStr(item as WidgetContent, "image"),
          ) || undefined,
      },
    });
  };

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
              count={speakers.length}
            />
            {categories.map(({ label, count }) => (
              <FilterChip
                key={label}
                active={active === label}
                onClick={() => {
                  setActive(label);
                  resetPagination();
                }}
                label={label}
                count={count}
              />
            ))}
            {(bookmarks.size > 0 || active === BOOKMARKED_KEY) && (
              <FilterChip
                active={active === BOOKMARKED_KEY}
                onClick={() => {
                  setActive(BOOKMARKED_KEY);
                  resetPagination();
                }}
                label={bookmarkedLabel}
                count={bookmarks.size}
                icon={<BookmarkIcon className="h-3 w-3" aria-hidden />}
              />
            )}
          </div>
        )}
      </header>

      {(enableSearch || enableSort) && speakers.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {enableSearch && (
            <label className="relative flex-1">
              <span className="sr-only">{lang === "pl" ? "Szukaj" : "Search"}</span>
              <span className="pointer-events-none absolute left-3 top-0 flex h-10 w-10 items-center justify-center">
                <SearchIcon aria-hidden className="h-4 w-4 text-muted-foreground/60" />
              </span>
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
                className="h-10 w-full rounded-[6px] border border-border/60 bg-background pl-11 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/50"
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
          <p aria-live="polite" className="cms-meta whitespace-nowrap text-muted-foreground">
            {filtered.length === speakers.length
              ? `${speakers.length} ${lang === "pl" ? "prelegentów" : "speakers"}`
              : `${filtered.length} / ${speakers.length} ${lang === "pl" ? "prelegentów" : "speakers"}`}
          </p>
        </div>
      )}

      <div
        key={`${active}-${sort}-${query}`}
        className={`grid grid-cols-1 ${gridClass} gap-4 sm:gap-5`}
      >
        {paginated.map(({ item, id }, i) => (
          <SpeakerCard
            key={id}
            item={item}
            lang={lang}
            query={query}
            index={i}
            bookmarked={bookmarks.has(id)}
            onToggleBookmark={() => toggleBookmark(id)}
            onOpenProfile={() => onOpenProfile(item)}
          />
        ))}
        {paginated.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 py-8 text-center">
            <p className="cms-meta italic text-muted-foreground">
              {query
                ? lang === "pl"
                  ? "Brak wyników wyszukiwania."
                  : "No results."
                : active === BOOKMARKED_KEY
                  ? lang === "pl"
                    ? "Nie masz jeszcze zapisanych prelegentów."
                    : "You haven't saved any speakers yet."
                  : source !== "manual"
                    ? lang === "pl"
                      ? "Brak publicznych profili prelegentów."
                      : "No public speaker profiles."
                    : lang === "pl"
                      ? "Brak prelegentów w tej kategorii."
                      : "No speakers in this category."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-[6px] border border-border/70 bg-background px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-[color:var(--speakers-accent)]/50 hover:bg-[color:var(--speakers-accent)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/50"
              >
                {lang === "pl" ? "Wyczyść filtry" : "Clear filters"}
              </button>
            )}
          </div>
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

      {dialogSpeaker && (
        <Suspense fallback={null}>
          <SpeakerProfileDialogLazy
            userId={dialogSpeaker.userId}
            lang={lang}
            open
            onOpenChange={(open) => {
              if (!open) setDialogSpeaker(null);
            }}
            fallback={dialogSpeaker.fallback}
          />
        </Suspense>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-[6px] px-3.5 py-1.5 text-xs font-medium transition-all duration-200 " +
        (active
          ? "bg-[color:var(--speakers-accent)] text-white shadow-sm shadow-[color:var(--speakers-accent)]/25 scale-[1.02]"
          : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground")
      }
    >
      {icon}
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={
            "rounded-full px-1.5 text-[10px] font-semibold tabular-nums " +
            (active ? "bg-white/20 text-white" : "bg-background/80 text-muted-foreground")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SpeakerCard({
  item,
  lang,
  query,
  index,
  bookmarked,
  onToggleBookmark,
  onOpenProfile,
}: {
  item: SpeakerItem;
  lang: Lang;
  query: string;
  index: number;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenProfile?: () => void;
}) {
  const photo = safeImageUrl(
    getStr(item as WidgetContent, "photo") || getStr(item as WidgetContent, "image"),
  );
  const name = getStr(item as WidgetContent, "name");
  const role = loc(item, "role", lang);
  const category = loc(item, "category", lang).trim();
  const description = loc(item, "description", lang);
  const gigs = numOf(item.gigs);
  const rating = numOf(item.rating);
  const reviews = numOf(item.reviews);
  const rawHref = getStr(item as WidgetContent, "href");
  const href = rawHref ? safeUrl(rawHref, "") : "";
  const isExpert = item.isExpert === true;

  // Kaskadowe wejście kart: opóźnienie rośnie z indeksem (z sufitem, żeby
  // dalsze strony paginacji nie czekały sekundami na animację).
  const enterClass = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 fill-mode-both";
  const enterStyle: CSSProperties = { animationDelay: `${Math.min(index, 11) * 55}ms` };

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
      <BookmarkIcon className={"h-4 w-4 " + (bookmarked ? "fill-current" : "")} aria-hidden />
    </button>
  );

  const body = (
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-[12px] border border-border/60 bg-card text-card-foreground shadow-sm transition-all duration-300 " +
        (href
          ? "hover:-translate-y-1 hover:shadow-lg hover:shadow-[color:var(--speakers-accent)]/10 hover:border-[color:var(--speakers-accent)]/40"
          : "") +
        (href ? "" : ` ${enterClass}`)
      }
      style={href ? undefined : enterStyle}
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
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        {isExpert && (
          <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-[6px] bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur-sm">
            <ShieldCheck aria-hidden className="h-3 w-3" />
            {lang === "pl" ? "Ekspert" : "Expert"}
          </span>
        )}
        {category && (
          <span className="absolute bottom-2 left-2 z-10 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {category}
          </span>
        )}

        {bookmarkBtn}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {name && (
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">
            <Highlight text={name} query={query} />
          </h3>
        )}
        {(role || gigs > 0) && (
          <p className="cms-meta">
            <Highlight text={role} query={query} />
            {role && gigs > 0 ? " · " : ""}
            {gigs > 0 ? `${gigs} ${lang === "pl" ? "wystąpień" : "gigs"}` : ""}
          </p>
        )}
        {(rating > 0 || reviews > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rating > 0 && (
              <span className="font-semibold text-foreground">{rating.toFixed(1)}</span>
            )}
            <SpeakerStars rating={rating} />
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

  if (onOpenProfile) {
    return (
      <button
        type="button"
        onClick={onOpenProfile}
        className="block h-full w-full rounded-[6px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/60"
        aria-label={name || undefined}
      >
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <AppLink
        href={href}
        className={`block h-full rounded-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/60 ${enterClass}`}
        style={enterStyle}
        aria-label={name || undefined}
      >
        {body}
      </AppLink>
    );
  }
  return body;
}
