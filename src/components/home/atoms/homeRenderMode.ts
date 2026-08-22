// Wybór WARIANTU TREŚCI strony głównej - czysta decyzja, bez Reacta.
//
// PO CO OSOBNO. W `routes/index.tsx` ta decyzja żyła jako zagnieżdżony ternary
// wpleciony w JSX (`isLatestPosts ? ... : doc && doc.sections.length > 0 ? ...
// : ...`), więc jej trzy wyjścia dało się sprawdzić wyłącznie przez montaż
// całej strony głównej z atrapami buildera, reklam i zapytań. To najdroższe
// możliwe pokrycie najtańszej możliwej logiki - a to najczęściej odwiedzana
// trasa serwisu, więc pomyłka w tym warunku jest najkosztowniejsza w repo.
//
// DLACZEGO UNIA ROZŁĄCZNA, A NIE SAM STRING. Wariant „builder" NIESIE dokument,
// więc konsument nie musi go już sprawdzać drugi raz (`mode === "builder" &&
// doc`). Drugie sprawdzenie tego samego warunku byłoby gałęzią NIEOSIĄGALNĄ:
// nie da się jej wywołać z testu, a mimo to na zawsze zostałaby w raporcie
// pokrycia trasy jako brakująca.
//
// ZACHOWANIE JEST ZACHOWANE 1:1 (kolejność warunków, semantyka `?.`/`&&`).
import type { BuilderDocument } from "@/lib/builder/types";
import type { HomepageMode, PageData } from "@/lib/queries/public";

/** Trzy rozłączne warianty treści strony głównej. */
export type HomeContent =
  { kind: "latest_posts" } | { kind: "builder"; doc: BuilderDocument } | { kind: "empty" };

/**
 * Surowy `builder_data` strony głównej ALBO `null`, gdy dokumentu nie ma po co
 * parsować. `null` w trybie „najnowsze wpisy" jest ważny: `homePageQueryOptions`
 * z konstrukcji nie ładuje wtedy strony statycznej, a bez tego warunku ukryta
 * kanwa CMS-owa wracałaby do renderu przy każdym przełączeniu trybu.
 */
/**
 * Strona główna w kształcie, który ta decyzja faktycznie czyta. Zawężenie
 * z `PageData` (22 kolumny) do dwóch używanych pól: atom nie potrzebuje reszty,
 * a wywołania się nie zmieniają, bo `PageData` spełnia ten kształt.
 */
export type HomeBuilderCandidate = Pick<PageData, "editor" | "builder_data">;

export function homeBuilderSource(
  homeMode: HomepageMode,
  homePage: HomeBuilderCandidate | null,
): unknown {
  if (homeMode === "latest_posts") return null;
  return homePage?.editor === "builder" ? homePage.builder_data : null;
}

/**
 * Wariant treści. Dokument PUSTY (zero sekcji) i dokument BRAKUJĄCY dają ten
 * sam wynik `empty` - czytelnik ma zobaczyć zdanie „zajrzyj wkrótce", nie pustą
 * powłokę buildera.
 */
export function homeContent(homeMode: HomepageMode, doc: BuilderDocument | null): HomeContent {
  if (homeMode === "latest_posts") return { kind: "latest_posts" };
  if (doc && doc.sections.length > 0) return { kind: "builder", doc };
  return { kind: "empty" };
}
