// OBSERWOWANE: chipy obserwacji + PRAWDZIWY feed postów obserwowanych autorów,
// kategorii i tagów (RPC `get_followed_feed`).
//
// ORGANIZM: skleja trzy źródła (lista obserwacji, nazwy obserwowanych bytów,
// strony feedu) i podaje je molekułom. Zapytanie o nazwy jest WYŁĄCZONE, gdy
// nie ma żadnej obserwacji - inaczej czytelnik bez obserwacji odpytywałby trzy
// tabele o pustą listę identyfikatorów.
//
// TRZY STANY SĄ ROZŁĄCZNE:
//   * BRAK OBSERWACJI -> zaproszenie do wyboru zainteresowań (nie ma czego
//     pokazywać, bo czytelnik jeszcze nic nie wybrał),
//   * feed w locie -> „ładowanie",
//   * feed PUSTY -> „obserwowani nie mają jeszcze nowych publikacji" (obserwacje
//     są, tylko nic nowego nie wyszło) - to INNY komunikat i inna przyczyna.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useFollows, useToggleFollow } from "@/hooks/useFollows";
import { useFollowedFeed } from "@/hooks/useFollowedFeed";
import { dedupeById } from "@/lib/collections/dedupeById";
import { buildFollowChips } from "@/components/readingList/atoms/followChips";
import { gridColsClass } from "@/components/readingList/atoms/gridColsClass";
import { FollowChips } from "@/components/readingList/molecules/FollowChips";
import { ReadingListEmptyState } from "@/components/readingList/molecules/ReadingListEmptyState";
import { ReadingListPostCard } from "@/components/readingList/molecules/ReadingListPostCard";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function FollowedSection({ columns, lang }: { columns: number; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const { data: follows } = useFollows();
  const feed = useFollowedFeed();
  const toggle = useToggleFollow();

  const catIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "category").map((f) => f.target_id),
    [follows],
  );
  const tagIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "tag").map((f) => f.target_id),
    [follows],
  );
  const authorIds = useMemo(
    () => (follows ?? []).filter((f) => f.target_type === "author").map((f) => f.target_id),
    [follows],
  );

  const { data: entities } = useQuery({
    queryKey: ["followed-entities", catIds.join(","), tagIds.join(","), authorIds.join(",")],
    enabled: (follows ?? []).length > 0,
    queryFn: async () => {
      const [cats, tags, authors] = await Promise.all([
        catIds.length
          ? supabase.from("categories").select("id, name_pl, name_en, slug").in("id", catIds)
          : Promise.resolve({
              data: [] as Array<{ id: string; name_pl: string; name_en: string; slug: string }>,
            }),
        tagIds.length
          ? supabase.from("tags").select("id, name, slug").in("id", tagIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }> }),
        authorIds.length
          ? supabase
              .from("profiles")
              .select("id, display_name, avatar_url, slug")
              .in("id", authorIds)
          : Promise.resolve({
              data: [] as Array<{
                id: string;
                display_name: string | null;
                avatar_url: string | null;
                slug: string | null;
              }>,
            }),
      ]);
      return { cats: cats.data ?? [], tags: tags.data ?? [], authors: authors.data ?? [] };
    },
  });

  const chips = useMemo(() => (entities ? buildFollowChips(entities, lang) : []), [entities, lang]);

  if (!follows || follows.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>{t("readingList.followedEmpty")}</p>
        <Link to="/profile/interests" className="mt-4 inline-block text-brand hover:underline">
          {t("readingList.followedEmptyCta")}
        </Link>
      </div>
    );
  }

  // Dedupe po id: publikacja nowego posta między stronami przesuwa okno
  // offsetu i ten sam rekord może wrócić na kolejnej stronie.
  const items = dedupeById((feed.data?.pages ?? []).flat());

  return (
    <div>
      <FollowChips
        chips={chips}
        pending={toggle.isPending}
        onUnfollow={(chip) =>
          toggle.mutate({ targetType: chip.type, targetId: chip.id, on: false })
        }
      />

      {feed.isLoading ? (
        <p className="text-center text-muted-foreground">{t("readingList.loading")}</p>
      ) : items.length === 0 ? (
        <ReadingListEmptyState text={t("readingList.followedFeedEmpty")} />
      ) : (
        <>
          <div className={`grid gap-6 ${gridColsClass(columns)}`}>
            {items.map((p) => (
              <ReadingListPostCard key={p.id} post={p} lang={lang} reasons={p.reasons} />
            ))}
          </div>
          {feed.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage ? t("readingList.loading") : t("readingList.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
