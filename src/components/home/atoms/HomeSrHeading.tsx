// Nagłówek POZIOMU 1 strony głównej. JEDYNE jego źródło w całym serwisie.
//
// DLACZEGO WRÓCIŁ DO TRASY (regresja odziedziczona z `main`, bramka `e2e`:
// `e2e/ssr-completeness.spec.ts` wymaga DOKŁADNIE jednego `<h1>` w HTML-u
// serwera dla `/` i `/en`). 2026-09-14 ten atom został skasowany (commit
// ead1f02), a pięć minut później (e246675) jedyny `h1` strony głównej
// zamieszkał w chrome nagłówka witryny (`components/header/atoms/
// HeaderSeoHeading.tsx`, renderowany przez `components/Header.tsx` pod
// warunkiem `isHome`). Przeniesienie wyglądało na neutralne, ale przypięło
// najważniejszy nagłówek SEO serwisu do CUDZYCH DANYCH: `Header` zwracał
// `HeaderSkeleton` (zero nagłówków), gdy `site_settings` nie dojechały
// (`dataUpdatedAt === 0`) ALBO gdy nie było w nich kanwy nagłówka
// (`header.builder_data.sections`). Przy martwym backendzie - a taki jest
// kontrakt suity e2e (placeholderowe poświadczenia Supabase) - strona główna
// zostawała BEZ ŻADNEGO `h1`: ani w powłoce, ani w treści.
//
// `HeaderSeoHeading` ZOSTAŁ USUNIĘTY z powłoki (zgodnie z ustaleniem tego
// samego przeglądu), więc dziś nie ma DRUGIEGO kandydata na `h1` w chrome.
// Ten atom jest jedynym właścicielem nagłówka strony głównej i renderuje go
// BEZWARUNKOWO - z jednym wyjątkiem opisanym niżej. Gdyby kiedykolwiek wrócił
// `h1` do powłoki, wróciłby wraz z nim defekt „dwa `h1` na stronie głównej";
// pilnują tego testy, nie lustrzana kopia warunków `Header.tsx` (taka kopia
// stała tu przez chwilę i sama była defektem: po usunięciu `HeaderSeoHeading`
// wyciszała nagłówek na PRODUKCYJNEJ stronie głównej, zostawiając `h1`
// wyłącznie na ścieżce zdegradowanej).
//
// JEDYNY WARUNEK POMINIĘCIA: dokument buildera SAM niesie nagłówek poziomu 1
// (widget z tagiem `h1` albo `<h1>` w treści bogatej) - `builderDocHasTopHeading`.
// To ta sama reguła, którą dla stron CMS-owych trzyma `BuilderPageShell`
// (audyt 2026-08-06, korekta 2): DWA `h1` to defekt dostępności i SEO, a nie
// kosmetyka.
//
// DLACZEGO `sr-only`, SKORO 2026-09-14 NAGŁÓWEK BYŁ WIDOCZNY. Wymóg redakcyjny
// spisany przy przenosinach do powłoki mówi wprost: `h1` ma istnieć w kodzie
// strony, ale nie ma być widoczny w layoucie - kanwa strony głównej rysuje
// własny hero i drugi, dorysowany pasek tytułu psułby projekt. Komentarz bramki
// e2e mówi to samo („strona główna używa H1 `sr-only`"). `sr-only`, a nie
// `hidden`/`display:none` - nagłówek MUSI zostać w drzewie dostępności.
//
// TREŚĆ NIE JEST JUŻ DWUJĘZYCZNYM LITERAŁEM W KODZIE (dawny dług tego atomu,
// udokumentowany wtedy testem `it.fails`): przychodzi propsem z
// `homeSrHeadingText`, czyli z tego samego źródła, co domyślny `<title>`.
import { builderDocHasTopHeading } from "@/lib/builder/headings";
import type { BuilderDocument } from "@/lib/builder/types";

export interface HomeSrHeadingProps {
  /** Tekst nagłówka - patrz `homeSrHeadingText` w `homeHeadingSource.ts`. */
  title: string;
  /** Dokument kanwy strony głównej (`null` w trybie listy wpisów i przy pustce). */
  doc: BuilderDocument | null;
  /**
   * Nagłówek WIDOCZNY zamiast `sr-only` - wyłącznie wtedy, gdy treść strony
   * głównej nie dojechała (zasiew awaryjny, `HomeLoadingNotice`). Kanwy wtedy
   * nie ma, więc nie ma też hero, z którym pasek tytułu by się kłócił, a nazwa
   * marki musi być najwidoczniejszym tekstem dokumentu: inaczej wyszukiwarka
   * bierze za tytuł wyniku komunikat o wczytywaniu (zgłoszenie 2026-10-09,
   * „Loading the homepage" w wyniku na nazwę marki).
   */
  visible?: boolean;
}

export function HomeSrHeading({ title, doc, visible = false }: HomeSrHeadingProps) {
  if (builderDocHasTopHeading(doc)) return null;
  return (
    <h1
      className={
        visible
          ? "mx-auto w-full max-w-[1200px] px-4 pt-10 font-display text-3xl font-semibold tracking-tight text-foreground lg:px-8"
          : "sr-only"
      }
    >
      {title}
    </h1>
  );
}
