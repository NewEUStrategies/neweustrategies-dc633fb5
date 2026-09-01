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
  // TA SAMA FABRYKA, CO W LOADERZE `/$` - jedno źródło klucza. Loader grzeje ją
  // przez `ensureQueryData`, więc na serwerze wpis jest już rozstrzygnięty i ten
  // komponent renderuje LISTĘ, nie gałąź przejściową (do 2026-09-01 SSR strony
  // sekcyjnej nie zawierał ani jednego wpisu).
  const { data: rows = [], isLoading } = useQuery(archiveListingQueryOptions(parentPageId));

  if (isLoading) return <p className="text-sm text-muted-foreground py-6">...</p>;
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
