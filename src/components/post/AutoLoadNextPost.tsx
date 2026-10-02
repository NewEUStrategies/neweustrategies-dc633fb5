// AutoLoadNextPost - obserwuje koniec aktualnego artykułu i ładuje
// kolejny opublikowany wpis (chronologicznie wstecz) w obrębie tej
// samej strony nadrzędnej. Pasek adresu i tytuł karty idą za wpisem, który
// czytelnik AKTUALNIE czyta - artykułem otwartym albo dowolnym doładowanym
// (`useAddressFollowsReading`), żeby udostępniony link i odsłona w analityce
// dotyczyły tego, co jest na ekranie. SSR-safe (cała logika w useEffect).
//
// Warunki doładowania (koniec artykułu, limit łańcucha, strażnik podwójnego
// wywołania) i wybór kursora żyją w czystym module `lib/post/autoLoadChain`.
// Wcześniej siedziały w callbacku `IntersectionObserver`, więc ich sprawdzenie
// wymagało atrapy obserwatora - a atrapa, która „widzi" sentinel w niewłaściwym
// momencie, dowodzi czegoś innego niż reguła.
import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchNextPost, type NextPostSummary } from "@/lib/queries/nextPost";
import { trackPageView } from "@/lib/analytics/track";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { SectionEyebrow } from "@/components/post/atoms/SectionEyebrow";
import {
  DEFAULT_MAX_CHAIN,
  chainHeadingId,
  nextCursor,
  shouldRequestNext,
} from "@/lib/post/autoLoadChain";

interface Props {
  currentPostId: string;
  parentPageId: string;
  currentPublishedAt: string | null;
  lang: "pl" | "en";
  /** Ile sekwencyjnych „kolejnych wpisów" pozwolić załadować. */
  maxChain?: number;
}

interface Loaded {
  post: NextPostSummary;
  appendedAt: number;
}

const LABELS = {
  pl: {
    loading: "Ładuję następny wpis...",
    end: "To już wszystkie wpisy.",
    next: "Następny artykuł",
  },
  en: { loading: "Loading next article...", end: "No more articles.", next: "Next article" },
} as const;

/**
 * Pas czytania: górne 20% okna. Wpis jest „czytany", gdy jego górna krawędź
 * zeszła już do tego pasa - bieżącym jest OSTATNI taki wpis łańcucha, a gdy
 * żaden - artykuł otwarty przez czytelnika (stoi nad łańcuchem).
 */
const READING_BAND = "0px 0px -80% 0px";

function postTitle(post: NextPostSummary, lang: "pl" | "en"): string {
  return lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Podmiana adresu BEZ nawigacji routera.
 *
 * Natywne `History.prototype.replaceState`, a nie `window.history.replaceState`:
 * TanStack Router podmienia tę metodę na instancji `window.history` i każde
 * jej wywołanie z zewnątrz ogłasza swoim subskrybentom jako nawigację
 * (`@tanstack/history`, `onPushPop("REPLACE")`), a `Transitioner` odpowiada na
 * to `router.load()` - czyli trasą doładowanego wpisu w miejscu całego artykułu.
 * Stan wpisu historii (`__TSR_key`, `__TSR_index`) zostaje nietknięty - na nim
 * stoją przywracanie przewinięcia i rozpoznawanie kierunku wstecz/naprzód.
 */
function writeAddress(href: string, title: string): void {
  History.prototype.replaceState.call(window.history, window.history.state, "", href);
  document.title = title;
}

interface ShownAddress {
  postId: string;
  href: string;
  /** `history.state` tuż po zapisie - inny obiekt znaczy, że wpis historii zmienił ktoś inny. */
  state: unknown;
}

/**
 * Pasek adresu i tytuł karty za wpisem w pasie czytania - w OBIE strony.
 *
 * Wcześniej obserwowany był tylko ostatni doładowany nagłówek, a adres
 * przełączał się wyłącznie „w przód": po powrocie do artykułu otwartego pasek
 * dalej wskazywał doładowany wpis (zły link przy udostępnianiu, zła
 * kanoniczność, zła odsłona). Teraz jeden obserwator patrzy na WSZYSTKIE wpisy
 * łańcucha, a powrót nad łańcuch przywraca pierwotny adres i tytuł - także
 * przy odmontowaniu, o ile nikt w międzyczasie nie przeszedł gdzie indziej.
 */
function useAddressFollowsReading(
  rootRef: RefObject<HTMLDivElement | null>,
  chain: readonly Loaded[],
  lang: "pl" | "en",
): void {
  const originalRef = useRef<{ href: string; title: string } | null>(null);
  const shownRef = useRef<ShownAddress | null>(null);
  // Jedna odsłona na wpis i montowanie - przewijanie tam i z powrotem nie liczy jej drugi raz.
  const trackedRef = useRef(new Set<string>());

  useEffect(() => {
    const root = rootRef.current;
    if (chain.length === 0 || !root) return;
    const articles = Array.from(root.querySelectorAll<HTMLElement>("[data-next-post-id]"));
    const started = new Map<Element, boolean>();

    const show = (post: NextPostSummary | null) => {
      const shown = shownRef.current;
      if (!post) {
        if (!shown || !originalRef.current) return;
        writeAddress(originalRef.current.href, originalRef.current.title);
        shownRef.current = null;
        return;
      }
      if (shown?.postId === post.id) return;
      // Pierwotny adres zapamiętujemy przy KAŻDYM zejściu z artykułu otwartego -
      // czytelnik mógł w nim w międzyczasie przejść do przypisu (#fn-…).
      if (!shown) originalRef.current = { href: currentHref(), title: document.title };
      writeAddress(post.href, postTitle(post, lang));
      shownRef.current = { postId: post.id, href: currentHref(), state: window.history.state };
      if (!trackedRef.current.has(post.id)) {
        trackedRef.current.add(post.id);
        trackPageView(undefined, { source: "auto_load_next_post" });
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Poza pasem od góry (przeczytany) wpis nadal jest „zaczęty";
          // poza pasem od dołu - czytelnik wrócił nad niego.
          started.set(
            e.target,
            e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.top ?? 0),
          );
        }
        const reading = articles.filter((el) => started.get(el)).at(-1);
        const id = reading?.getAttribute("data-next-post-id");
        show(chain.find((c) => c.post.id === id)?.post ?? null);
      },
      { rootMargin: READING_BAND },
    );
    for (const el of articles) io.observe(el);
    return () => io.disconnect();
  }, [rootRef, chain, lang]);

  useEffect(
    () => () => {
      const shown = shownRef.current;
      const original = originalRef.current;
      if (!shown || !original) return;
      // Nawigacja routera (inny adres albo nowy wpis historii z tym samym
      // adresem - klik w tytuł doładowanego wpisu) należy już do nowej strony.
      if (currentHref() !== shown.href || window.history.state !== shown.state) return;
      writeAddress(original.href, original.title);
    },
    [],
  );
}

export function AutoLoadNextPost(props: Props) {
  // Łańcuch należy do JEDNEGO artykułu otwartego. Trasa `$` nie przemontowuje
  // tego komponentu przy nawigacji SPA na inny wpis (np. klik w tytuł
  // doładowanego), więc bez klucza stan poprzedniego artykułu zostawał pod
  // nowym - z duplikatem wpisu właśnie otwartego i z cudzym kursorem.
  return <AutoLoadNextPostChain key={props.currentPostId} {...props} />;
}

function AutoLoadNextPostChain({
  currentPostId,
  parentPageId,
  currentPublishedAt,
  lang,
  maxChain = DEFAULT_MAX_CHAIN,
}: Props) {
  const L = LABELS[lang] ?? LABELS.pl;
  const [chain, setChain] = useState<Loaded[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestedRef = useRef(false);

  // current "cursor" = last loaded post or starting point
  const cursor = nextCursor(chain, { id: currentPostId, publishedAt: currentPublishedAt });

  useEffect(() => {
    if (done || chain.length >= maxChain) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      async (entries) => {
        const allowed = shouldRequestNext({
          done,
          chainLength: chain.length,
          maxChain,
          loading,
          requested: requestedRef.current,
          intersecting: entries.some((e) => e.isIntersecting),
        });
        if (!allowed) return;
        requestedRef.current = true;
        setLoading(true);
        try {
          const next = await fetchNextPost({
            currentPostId: cursor.id,
            parentPageId,
            currentPublishedAt: cursor.publishedAt,
          });
          if (!next) {
            setDone(true);
            return;
          }
          setChain((prev) => [...prev, { post: next, appendedAt: Date.now() }]);
        } finally {
          setLoading(false);
          requestedRef.current = false;
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor.id, cursor.publishedAt, parentPageId, done, loading, chain.length, maxChain]);

  useAddressFollowsReading(rootRef, chain, lang);

  return (
    <div ref={rootRef} className="auto-load-next-post mt-12">
      {chain.map((c) => {
        const title = postTitle(c.post, lang);
        // Render via the shared engine so blocks/builder posts (the default
        // editor) show their real body - not just legacy content_* HTML, which
        // is empty for them.
        const builderDoc = parseBuilderDoc(c.post.builder_data);
        const blocksData = (c.post.blocks_data as LocalizedBlocks | null) ?? null;
        const blocksDoc: BlocksDoc | null = blocksData
          ? (blocksData[lang] ?? blocksData.pl ?? blocksData.en ?? null)
          : null;
        const html =
          (lang === "en"
            ? c.post.content_en || c.post.content_pl
            : c.post.content_pl || c.post.content_en) ?? "";
        return (
          <article
            key={c.post.id}
            data-next-post-id={c.post.id}
            className="border-t-2 border-border pt-10 mt-10"
          >
            <SectionEyebrow className="mb-3">{L.next}</SectionEyebrow>
            <h2 id={chainHeadingId(c.post.id)} className="font-display text-3xl lg:text-4xl mb-4">
              <AppLink href={c.post.href} className="hover:text-primary">
                {title}
              </AppLink>
            </h2>
            {c.post.cover_image_url && (
              <OptimizedImage
                src={c.post.cover_image_url}
                alt={title}
                responsive
                sizes="(max-width: 768px) 100vw, 800px"
                className="w-full rounded-lg mb-6 max-h-[420px] object-cover"
              />
            )}
            <ContentRenderer
              editor={c.post.editor}
              builderDoc={builderDoc}
              blocksDoc={blocksDoc}
              html={html}
              lang={lang}
              postId={c.post.id}
            />
          </article>
        );
      })}

      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      {loading && (
        <div role="status" aria-live="polite" className="py-8">
          <span className="sr-only">{L.loading}</span>
          {/* Artykułowy skeleton zamiast gołego tekstu - czytelnik widzi, że
              wjeżdża kolejny wpis, a nie generyczne "Ładowanie…". */}
          <div aria-hidden="true" className="mx-auto max-w-3xl space-y-4">
            <div className="skeleton-shimmer h-8 w-3/4 rounded" />
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer aspect-[16/8] w-full rounded-xl" />
            <div className="skeleton-shimmer h-4 w-full rounded" />
            <div className="skeleton-shimmer h-4 w-5/6 rounded" />
          </div>
        </div>
      )}
      {done && <p className="text-center text-xs text-muted-foreground py-6">{L.end}</p>}
    </div>
  );
}
