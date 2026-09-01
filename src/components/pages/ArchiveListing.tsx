// Render listy opublikowanych dzieci (postów lub stron) dla
// template_type === 'archive_listing'. Używa public Data API z
// `posts.parent_page_id = parentPageId`.
import { useQuery } from "@tanstack/react-query";
import { PostListCard } from "@/components/molecules/PostListCard";
import { archiveListingQueryOptions } from "@/lib/queries/archiveListing";

interface Props {
  parentPageId: string;
  lang: "pl" | "en";
  parentPath: string; // e.g. "blog" or "news/2024"
}

const L = {
  pl: { empty: "Brak opublikowanych wpisów w tej sekcji.", read: "Czytaj dalej" },
  en: { empty: "No published posts in this section yet.", read: "Read more" },
} as const;

export function ArchiveListing({ parentPageId, lang, parentPath }: Props) {
  const t = L[lang] ?? L.pl;
  // TA SAMA FABRYKA, CO W LOADERZE `/$` - jedno źródło klucza, więc rozgrzany
  // wpis nie ma jak minąć się z odczytem.
  //
  // ROZGRZEWKA JEST BEST-EFFORT, NIE GWARANCJĄ: loader woła `prefetchQuery`
  // wewnątrz wspólnej, BUDŻETOWANEJ paczki wtórnej (`SECONDARY_PREFETCH_BUDGET_MS`),
  // bo lista sekcyjna nie może zatrzymać dokumentu. Dlatego rozróżnienie niżej
  // jest `isPending`, a NIE `isLoading`.
  //
  // DLACZEGO TO NIE JEST KOSMETYKA. `isLoading === isPending && isFetching`.
  // Gdy budżet wygaśnie, zapytanie zostaje w stanie `pending` z
  // `fetchStatus: "idle"` - czyli `isPending: true`, ale `isLoading: FALSE`
  // i `rows: []`. Warunek na `isLoading` przepuszczał wtedy render do gałęzi
  // „Brak opublikowanych wpisów w tej sekcji" i TO zdanie - a nie lista do 60
  // wpisów - wchodziło do NES Edge Cache na do 24 h, przy HTTP 200. `isPending`
  // rozróżnia „nie wiem jeszcze" od „wiem, że pusto", i tylko drugie z tych
  // dwóch wolno napisać czytelnikowi i crawlerowi.
  const { data: rows = [], isPending } = useQuery(archiveListingQueryOptions(parentPageId));

  if (isPending) return <p className="text-sm text-muted-foreground py-6">...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-6">{t.empty}</p>;

  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8 not-prose">
      {rows.map((r) => (
        <li key={r.id}>
          <PostListCard
            post={r}
            href={`/${parentPath}/${r.slug}`}
            lang={lang}
            link="app"
            imageZoom
            titleClassName="text-lg"
            viewTransitionId={r.id}
          />
        </li>
      ))}
    </ul>
  );
}
