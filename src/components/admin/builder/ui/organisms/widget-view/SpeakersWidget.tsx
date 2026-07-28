// Widget "Speakers" - kartowa siatka prelegentów z filtrem kategorii,
// wyszukiwarką, sortowaniem (ocena/wystąpienia/opinie) i paginacją "load more".
// Wzorzec UI zainspirowany designem "mentors-section" (portret + rola + ocena
// + opis), zaadaptowany do naszej typografii (.cms-*), tokenów Theme Design
// i dark/light modes. Każdy speaker ma pola i18n (rola/kategoria/opis) oraz
// opcjonalny link `href` (np. do profilu eksperta).
//
// Źródła danych (content.source):
//  - "manual"    - lista wpisana ręcznie w edytorze (legacy, domyślne),
//  - "directory" - publiczne profile prelegentów (speaker_profiles / CRM)
//                  przez RPC get_public_speakers,
//  - "event"     - prelegenci wskazanego wydarzenia (event_speakers).
// W trybach z bazy klik na karcie otwiera SpeakerProfileDialog (profil
// prelegenta + profil eksperta + lista wystąpień), o ile openProfile != false.
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { ShieldCheck, User as UserIcon, Search as SearchIcon } from "@/lib/lucide-shim";
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

/** Wiersz z RPC -> kształt karty (ten sam, co wpisy ręczne), więc filtrowanie,
 *  sortowanie i paginacja działają identycznie dla każdego źródła. */
function speakerRowToItem(row: PublicSpeakerRow, lang: Lang): SpeakerItem {
  void lang;
  const rolePl = row.headline_pl || row.job_title || "";
  const roleEn = row.headline_en || row.job_title || "";
  return {
    id: row.user_id,
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

  const speakers: SpeakerItem[] = useMemo(() => {
    if (source === "manual") return manualSpeakers;
    return (dbQ.data ?? []).map((row) => speakerRowToItem(row, lang));
  }, [source, manualSpeakers, dbQ.data, lang]);

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
  const [dialogSpeaker, setDialogSpeaker] = useState<{
    userId: string;
    fallback: SpeakerDialogFallback;
  } | null>(null);

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

  const dbLoading = source !== "manual" && dbQ.isLoading;

  return (
    <section className="cms-speakers space-y-6" style={accentStyle}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : <span />}
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

      {dbLoading ? (
        <div aria-hidden className={`grid grid-cols-1 ${gridClass} gap-4 sm:gap-5`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-[6px] bg-muted/60" />
          ))}
        </div>
      ) : (
        <div
          key={`${active}-${sort}-${query}`}
          className={`grid animate-in fade-in-0 duration-200 grid-cols-1 ${gridClass} gap-4 sm:gap-5`}
        >
          {paginated.map((s, i) => (
            <SpeakerCard
              key={(s.id as string) ?? i}
              item={s}
              lang={lang}
              onOpenProfile={
                openProfile && typeof s.userId === "string" && s.userId
                  ? () =>
                      setDialogSpeaker({
                        userId: s.userId as string,
                        fallback: {
                          name: getStr(s as WidgetContent, "name"),
                          role: loc(s, "role", lang),
                          photo: getStr(s as WidgetContent, "photo") || undefined,
                        },
                      })
                  : undefined
              }
            />
          ))}
          {paginated.length === 0 && (
            <p className="cms-meta col-span-full text-center italic text-muted-foreground">
              {query
                ? lang === "pl"
                  ? "Brak wyników wyszukiwania."
                  : "No results."
                : source !== "manual"
                  ? lang === "pl"
                    ? "Brak publicznych profili prelegentów."
                    : "No public speaker profiles."
                  : lang === "pl"
                    ? "Brak prelegentów w tej kategorii."
                    : "No speakers in this category."}
            </p>
          )}
        </div>
      )}

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
        "rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors " +
        (active
          ? "bg-[color:var(--speakers-accent)] text-white shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-muted/70")
      }
    >
      {label}
    </button>
  );
}

function SpeakerCard({
  item,
  lang,
  onOpenProfile,
}: {
  item: SpeakerItem;
  lang: Lang;
  onOpenProfile?: () => void;
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
  const isExpert = item.isExpert === true;
  const interactive = !!onOpenProfile || !!href;

  const body = (
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-[6px] border border-border/60 bg-card text-card-foreground shadow-sm transition-all duration-300 " +
        (interactive
          ? "hover:-translate-y-0.5 hover:shadow-md hover:border-[color:var(--speakers-accent)]/40"
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
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-muted-foreground/40"
          >
            <UserIcon className="h-12 w-12" />
          </span>
        )}
        {isExpert && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-[6px] bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-brand-ink shadow-sm backdrop-blur-sm">
            <ShieldCheck aria-hidden className="h-3 w-3" />
            {lang === "pl" ? "Ekspert" : "Expert"}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {name && <h3 className="text-base font-semibold leading-tight text-foreground">{name}</h3>}
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
        className="block h-full rounded-[6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent)]/60"
        aria-label={name || undefined}
      >
        {body}
      </AppLink>
    );
  }
  return body;
}
