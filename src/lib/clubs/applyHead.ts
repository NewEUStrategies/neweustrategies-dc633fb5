// SEO dla strony zgłoszenia do klubu (/club/apply).
//
// DLACZEGO OSOBNY PLIK, A NIE SŁOWNIK i18n - DWA POWODY, OBA ZMIERZONE.
//
// 1. POPRAWNOŚĆ. `head()` biegnie na serwerze przed renderem komponentu i nie
//    może czytać globalnego singletona i18next: ta sama instancja obsługuje
//    równoległe żądania w workerze, więc jej `language` potrafi należeć do
//    innego użytkownika (patrz `lib/seo/head.ts`). Język bierzemy z adresu.
//    Dokładnie ten sam powód, co w bliźniaczym `specializationHead.ts`.
//
// 2. ROZMIAR CHUNKU WEJŚCIOWEGO - i to jest właściwa przyczyna powstania tego
//    pliku. Poprzednia wersja `club.apply.tsx` importowała SUROWE obiekty
//    słownika (`import { clubEn, clubPl } from "@/lib/i18n-club"`) i czytała
//    z nich `club.spec.apply.meta`. TanStack Start trzyma `head:` EAGER
//    w drzewie tras - a drzewo tras żyje w chunku WEJŚCIOWYM, tym, który ściąga
//    każdy anonimowy gość, żeby przeczytać jeden artykuł. `component:` jest
//    leniwy, `head:` nie jest. Jedna statyczna krawędź po CZTERY STRINGI
//    wciągała więc do entry cały słownik klubów.
//
//    Zmierzone na tym samym buildzie (gzip zlib L6, ta sama metoda co
//    `check-bundle-size.ts`): region słownika w zminifikowanym entry to 143 299
//    znaków, a jego usunięcie zdejmuje 48 583 B = 47,4 KB gzip, czyli 9,3%
//    chunku wejściowego. Chunk 511,4 -> 463,9 KB, zapas wobec progu 513 rośnie
//    z 1,6 KB do 49,1 KB.
//
//    NIE BYŁO to hoistowanie przez wielu importerów - ta hipoteza została
//    obalona pomiarem: entry importuje statycznie DOKŁADNIE sześć chunków
//    (wszystkie `vendor-*`), a `i18n-builder` (73 importy side-effect),
//    `i18n-profile` i `i18n-admin-analytics` mają własne chunki mimo większej
//    liczby importerów. Decyduje STATYCZNA OSIĄGALNOŚĆ z drzewa tras, nie
//    liczba importerów ani `ensureX()` vs import side-effect.
//
//    Bramkuje to `check:entry-purity` (klasa reguł "ciężkie słowniki poza
//    ścieżką bootowania") - budżet w kilobajtach mierzy skutek z opóźnieniem
//    i da się go skompensować ścięciem czegoś innego w tym samym PR.
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, type Lang } from "@/lib/seo/meta";

interface ApplySeoCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * Teksty przeniesione 1:1 z `i18n-club.ts` (`club.spec.apply.meta`), żeby
 * zmiana była neutralna dla wyszukiwarki. Nie miały ANI JEDNEGO wywołania
 * `t()` - jedynym konsumentem był `head()` tej trasy.
 */
const APPLY_SEO: Readonly<Record<Lang, ApplySeoCopy>> = {
  pl: {
    title: "Zaaplikuj do klubu dyskusyjnego | New European Strategies",
    description:
      "Zgłoś się do zamkniętego klubu dyskusyjnego ekspertów i decydentów. Wymagane konto i członkostwo PRO lub wyższe.",
  },
  en: {
    title: "Apply to a discussion club | New European Strategies",
    description:
      "Apply to a closed discussion club of experts and decision-makers. An account and PRO membership or higher are required.",
  },
};

/** Meta trasy `/club/apply` - język z adresu żądania, tekst ze stałej mapy. */
export function buildClubApplyHead(): ReturnType<typeof buildContentHead> {
  const url = getRequestUrl() || "/club/apply";
  const lang = activeLang(url);
  const copy = APPLY_SEO[lang];
  return buildContentHead({
    url,
    lang,
    type: "website",
    title: copy.title,
    description: copy.description,
    robots: "index, follow",
  });
}
