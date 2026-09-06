// REKOMENDACJE: jedna ścieżka dla zalogowanego i dla gościa
// (`get_recommended_posts_v2` liczy scoring w SQL-u).
//
// ORGANIZM. TRZY STANY SĄ TU JAWNIE ROZŁĄCZNE i w tej kolejności:
//   1. BŁĄD -> komunikat + „spróbuj ponownie" (jedyny stan z akcją ponowienia),
//   2. BRAK DANYCH (`undefined`) -> „ładowanie rekomendacji",
//   3. PUSTA LISTA -> zaproszenie do obserwowania kategorii.
// Zlanie 1 z 3 („brak rekomendacji" na awarię RPC) mówiłoby czytelnikowi, że
// system nie ma dla niego propozycji, kiedy w rzeczywistości nie zdołał zapytać.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRecommendedPosts } from "@/hooks/useRecommendedPosts";
import { gridColsClass } from "@/components/readingList/atoms/gridColsClass";
import { ReadingListEmptyState } from "@/components/readingList/molecules/ReadingListEmptyState";
import { ReadingListPostCard } from "@/components/readingList/molecules/ReadingListPostCard";

// Nakładka słownika rejestruje klucze `readingList.*` EFEKTEM UBOCZNYM importu.
// Przed wyprowadzeniem komponentów z trasy wciągała ją jedna linia w
// `routes/reading-list.tsx`; teraz każdy plik, który woła te klucze, musi ją
// zaimportować sam - inaczej klucz działa tylko wtedy, gdy nakładkę
// przypadkiem wciągnie inny moduł w tym samym chunku.
import "@/lib/i18n-reading-list";

export function RecommendedSection({
  columns,
  limit,
  lang,
}: {
  columns: number;
  limit: number;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const { data: posts, error, refetch } = useRecommendedPosts(limit);
  if (error)
    return (
      <div className="text-center py-10">
        <p className="mb-3 text-destructive">{t("readingList.recommendedError")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          {t("readingList.retry")}
        </Button>
      </div>
    );
  if (!posts)
    return (
      <p className="text-center text-muted-foreground">{t("readingList.loadingRecommendations")}</p>
    );
  if (posts.length === 0) return <ReadingListEmptyState text={t("readingList.recommendedEmpty")} />;
  return (
    <div>
      <h2 className="sr-only">{t("readingList.recommendedContentHeading")}</h2>
      <div className={`grid gap-6 ${gridColsClass(columns)}`}>
        {posts.map((p) => (
          <ReadingListPostCard key={p.id} post={p} lang={lang} reasons={p.reasons} />
        ))}
      </div>
    </div>
  );
}
