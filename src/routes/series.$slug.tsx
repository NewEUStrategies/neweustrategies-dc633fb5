// Strona serii/dossier (A8): /series/$slug - uporządkowane części cyklu.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { seriesPageQueryOptions } from "@/lib/queries/series";
import { PostListCard } from "@/components/molecules/PostListCard";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";

const COPY = {
  pl: { kicker: "Dossier", parts: "części", partLabel: "Część" },
  en: { kicker: "Dossier", parts: "parts", partLabel: "Part" },
} as const;

/** Projekcja pod synchroniczne `head()` - pełny wiersz jedzie w cache zapytań. */
interface SeriesHeadData {
  readonly namePl: string;
  readonly nameEn: string | null;
  readonly descriptionPl: string | null;
  readonly descriptionEn: string | null;
  readonly parts: number;
}

interface SeriesLoaderData {
  readonly headSeries: SeriesHeadData | null;
  readonly degraded: boolean;
}

/** Fallback zdegradowanego renderu (patrz lib/ssr/resilientLoad). */
const NO_SERIES = null;

export const Route = createFileRoute("/series/$slug")({
  // LOADER, KTÓREGO TA TRASA NIE MIAŁA. `useQuery` nie startuje na serwerze
  // fetcha, więc SSR nie zawierał ani nazwy cyklu, ani ani jednej części -
  // wyłącznie gałąź przejściową, konserwowaną w NES Edge Cache do 24 h. `head()`
  // był przy tym zahardkodowany na „Dossier", czyli KAŻDY cykl w serwisie
  // dzielił jeden tytuł i jeden opis.
  //
  // 404 JEST TERAZ PRAWDZIWYM 404. Wcześniej brak cyklu dawał pełny ekran
  // „nie znaleziono" przy statusie HTTP 200 - crawler indeksował go jako
  // istniejącą stronę. `notFound()` leci WYŁĄCZNIE z czystego odczytu:
  // przy degradacji transportu „nie wiemy" nie może zamienić się w 404.
  loader: async ({ context, params }): Promise<SeriesLoaderData> => {
    const { data, degraded } = await loadResilient(
      context.queryClient,
      seriesPageQueryOptions(params.slug),
      NO_SERIES,
    );
    setCacheControlHeader(resilientCacheControl(degraded));
    if (!degraded && data === null) throw notFound();
    return {
      degraded,
      headSeries:
        data === null
          ? null
          : {
              namePl: data.series.name_pl,
              nameEn: data.series.name_en,
              descriptionPl: data.series.description_pl,
              descriptionEn: data.series.description_en,
              parts: data.parts.length,
            },
    };
  },
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/series/${params.slug}`;
    const lang = activeLang(url);
    const s = loaderData?.headSeries ?? null;
    // Tytuł i opis STEROWANE DANYMI. Fallback języka jak w resztach tras:
    // wersja żądana, potem druga, potem stała - opis wpisany tylko po polsku
    // nie może zniknąć czytelnikowi z interfejsem EN.
    const name = s ? (lang === "en" ? s.nameEn || s.namePl : s.namePl || s.nameEn || "") : "";
    const title = name || "Dossier";
    const description =
      (s
        ? lang === "en"
          ? s.descriptionEn || s.descriptionPl
          : s.descriptionPl || s.descriptionEn
        : null) ||
      (lang === "en" ? "A sequential series of analyses." : "Sekwencyjny cykl analiz.");
    return buildContentHead({
      url,
      lang,
      type: "website",
      title,
      documentTitle: `${title} - ${SITE_NAME}`,
      description,
    });
  },
  component: SeriesPage,
  pendingComponent: () => <ArchiveSkeleton />,
});

function SeriesPage() {
  const { slug } = Route.useParams();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];
  // Loader rozgrzał ten klucz, więc `useSuspenseQuery` rozstrzyga się
  // synchronicznie w SSR i po hydratacji. Ładowanie obsługuje
  // `pendingComponent` trasy, a brak cyklu - `notFound()` z loadera.
  const { data } = useSuspenseQuery(seriesPageQueryOptions(slug));

  // Pas bezpieczeństwa dla nawigacji klientowej: adres rozstrzygnął już loader,
  // ale hooki muszą zostać bezwarunkowe (ta sama doktryna co `PublicPage` w /$).
  if (!data) return <PublicNotFound />;

  const name = lang === "en" ? data.series.name_en || data.series.name_pl : data.series.name_pl;
  const description =
    lang === "en"
      ? data.series.description_en || data.series.description_pl
      : data.series.description_pl || data.series.description_en;

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="container mx-auto max-w-5xl px-4 py-10 lg:py-14">
        <header className="mb-8">
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            <Layers className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
            {c.kicker} · {data.parts.length} {c.parts}
          </p>
          <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
          {description && <p className="mt-3 text-muted-foreground max-w-2xl">{description}</p>}
        </header>
        <ol className="grid gap-6 sm:grid-cols-2">
          {data.parts.map((part) => (
            <li key={part.post_id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -top-2 -left-2 z-10 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2 text-xs font-semibold text-brand-foreground shadow"
              >
                {part.part_number}
              </span>
              <PostListCard
                post={{
                  title_pl: part.title_pl,
                  title_en: part.title_en,
                  excerpt_pl: null,
                  excerpt_en: null,
                  cover_image_url: part.cover_image_url,
                  published_at: part.published_at,
                  is_sponsored: part.is_sponsored,
                  sponsored_kind: part.sponsored_kind,
                  sponsored_affiliate: part.sponsored_affiliate,
                }}
                href={part.href}
                lang={lang}
                titleClassName="text-base"
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
