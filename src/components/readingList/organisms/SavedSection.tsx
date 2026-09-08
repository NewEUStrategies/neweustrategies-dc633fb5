// ZAPISANE (zalogowany): wpisy i strony z `user_bookmarks`.
//
// ORGANIZM: skleja dane z prezentacją. Zakładki nie mają jednego zapytania -
// zakładki to lista IDENTYFIKATORÓW, a treść dociągają dwa osobne zapytania
// (wpisy i strony), każde WYŁĄCZONE, gdy nie ma czego pytać. Bez `enabled`
// czytelnik bez zapisanych stron i tak pukałby do tabeli `pages`.
//
// TRZY STANY SĄ ROZŁĄCZNE i w tej kolejności:
//   1. zakładki jeszcze się ładują -> „ładowanie",
//   2. zakładek NIE MA -> stan PUSTY (nie błąd, nie ładowanie),
//   3. zakładki są, ale treść jeszcze nie -> znów „ładowanie".
// Punkt 3 jest osobny, bo bez niego siatka mrugałaby stanem pustym między
// odpowiedzią o zakładkach a odpowiedzią o wpisach.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useBookmarks } from "@/hooks/useBookmarks";
import { supabase } from "@/integrations/supabase/client";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
import { gridColsClass } from "@/components/readingList/atoms/gridColsClass";
import { ReadingListEmptyState } from "@/components/readingList/molecules/ReadingListEmptyState";
import { ReadingListErrorState } from "@/components/readingList/molecules/ReadingListErrorState";
import {
  ReadingListPostCard,
  type ReadingListCardPost,
} from "@/components/readingList/molecules/ReadingListPostCard";
import { SavedPagesList, type SavedPage } from "@/components/readingList/molecules/SavedPagesList";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

/** Wiersz wpisu w zakresie kolumn, których potrzebuje karta. */
interface PostRow extends ReadingListCardPost {
  published_at: string | null;
  parent_page_id: string;
}

export function SavedSection({ columns, lang }: { columns: number; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const bookmarksQ = useBookmarks();
  const { data: bookmarks, isLoading } = bookmarksQ;
  const postIds = (bookmarks ?? []).filter((b) => b.entity_type === "post").map((b) => b.entity_id);
  // Wcześniej sekcja pomijała zapisane STRONY (tylko entity_type === "post"),
  // więc strona zapisana z paska czytania nie pojawiała się w /reading-list -
  // rozjazd z /profile/bookmarks, które pokazuje wpisy i strony. Teraz obie
  // powierzchnie „zapisanych" pokazują ten sam zakres.
  const pageIds = (bookmarks ?? []).filter((b) => b.entity_type === "page").map((b) => b.entity_id);
  const postsQ = useQuery({
    queryKey: ["saved-posts", postIds.join(",")],
    enabled: postIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, ${SPONSORED_LIST_COLS}`,
        )
        .in("id", postIds)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      return data as PostRow[];
    },
  });
  const pagesQ = useQuery({
    queryKey: ["saved-pages", pageIds.join(",")],
    enabled: pageIds.length > 0,
    queryFn: async (): Promise<SavedPage[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select("id, slug, title_pl, title_en")
        .in("id", pageIds)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      // Strony bywają zagnieżdżone - pełną ścieżkę zna DB (page_full_path).
      return Promise.all(
        (data ?? []).map(async (p) => {
          const { data: path } = await supabase.rpc("page_full_path", { _page_id: p.id });
          const raw = path && path.length > 0 ? path : p.slug;
          return { ...p, fullPath: raw.startsWith("/") ? raw : `/${raw}` } as SavedPage;
        }),
      );
    },
  });

  if (bookmarksQ.error || postsQ.error || pagesQ.error)
    return (
      <ReadingListErrorState
        message={t("readingList.savedError")}
        onRetry={() => {
          if (bookmarksQ.error) void bookmarksQ.refetch();
          if (postsQ.error) void postsQ.refetch();
          if (pagesQ.error) void pagesQ.refetch();
        }}
      />
    );
  if (isLoading)
    return <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>;
  if (postIds.length === 0 && pageIds.length === 0)
    return <ReadingListEmptyState text={t("readingList.savedEmpty")} />;
  const contentLoading =
    (postIds.length > 0 && !postsQ.data) || (pageIds.length > 0 && !pagesQ.data);
  if (contentLoading)
    return <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>;

  const posts = postsQ.data ?? [];
  const pages = pagesQ.data ?? [];
  if (posts.length === 0 && pages.length === 0)
    return <ReadingListEmptyState text={t("readingList.savedEmpty")} />;
  return (
    <div className="space-y-8">
      <h2 className="sr-only">{t("readingList.savedContentHeading")}</h2>
      {posts.length > 0 && (
        <div className={`grid gap-6 ${gridColsClass(columns)}`}>
          {posts.map((p) => (
            <ReadingListPostCard key={p.id} post={p} lang={lang} />
          ))}
        </div>
      )}
      {pages.length > 0 && <SavedPagesList pages={pages} lang={lang} />}
    </div>
  );
}
