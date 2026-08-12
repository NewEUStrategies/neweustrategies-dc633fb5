// Discussion Club - warstwa SEO tras klubowych.
//
// PROBLEM, KTORY TO ROZWIAZUJE. Wszystkie trasy modulu emitowaly jeden i ten
// sam naglowek: `{ name: "robots", content: "noindex,nofollow" }` i nic wiecej.
// Skutki byly dwa, oba wbrew projektowi modulu (V1 §5.1):
//
//   1. Klub `public` mial byc JEDYNA powierzchnia modulu, ktora dowozi ruch
//      z wyszukiwarek ("realny lejek pozyskania"). Bezwarunkowy `noindex`
//      zabieral mu te role calkowicie - komentarz w naglowku pliku trasy
//      opisywal warunkowa indeksowalnosc, ktorej kod nigdy nie mial.
//   2. Kazda strona klubu byla bez tytulu, opisu, kanonicznego adresu i karty
//      spolecznosciowej. Link do watku wklejony na LinkedIn pokazywal goly
//      adres, a zakladka przegladarki - domyslny tytul serwisu.
//
// DOKTRYNA. Indeksowalnosc liczy sie z WIDOCZNOSCI klubu, nie z trasy:
//
//   `public`  -> index, follow          (wizytowka, ma byc znaleziona)
//   pozostale -> noindex, nofollow      (members / private / secret)
//   nieznana  -> noindex, nofollow      (bezpieczny domysl przy awarii backendu)
//
// Ostatni wiersz jest wazny: gdy loader nie dowiezie danych (awaria bazy,
// budzet czasu), NIE zgadujemy. Brak odpowiedzi znaczy `noindex` - blad w te
// strone kosztuje ruch, blad w druga kosztuje wyciek nazwy klubu zamknietego
// do indeksu wyszukiwarki, skad usuwa sie ja tygodniami.
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, type Lang } from "@/lib/seo/meta";
import { pickPair } from "@/lib/i18n/pickLocalized";

/** Minimum, ktorego head() potrzebuje z karty klubu. Swiadomie waskie: loader
 *  ma dowiezc cztery pola, a nie caly wiersz - im mniej, tym mniejsza szansa,
 *  ze do naglowka trafi cos, czego czytelnik nie ma prawa zobaczyc. */
export interface ClubHeadSource {
  namePl: string;
  nameEn: string;
  taglinePl: string | null;
  taglineEn: string | null;
  coverImageUrl: string | null;
  visibility: string;
}

/** Wiersz z `club_view` sprowadzony do tego minimum. `null` wchodzi i wychodzi
 *  jako `null`: trasa 404 i awaria backendu maja dawac ten sam naglowek. */
export function toClubHeadSource(
  row: {
    name_pl: string;
    name_en: string;
    tagline_pl: string | null;
    tagline_en: string | null;
    cover_image_url: string | null;
    visibility: string;
  } | null,
): ClubHeadSource | null {
  if (!row) return null;
  return {
    namePl: row.name_pl,
    nameEn: row.name_en,
    taglinePl: row.tagline_pl,
    taglineEn: row.tagline_en,
    coverImageUrl: row.cover_image_url,
    visibility: row.visibility,
  };
}

/** Klub indeksowalny to WYLACZNIE klub `public`. Brak danych = nie. */
export function isClubIndexable(source: ClubHeadSource | null): boolean {
  return source?.visibility === "public";
}

/**
 * Wybor jezyka dla naglowka SEO. Polityka pustki idzie przez kanoniczny
 * `pickPair`, nie przez wlasne `??`: dawna wersja uznawala ciag SAMYCH SPACJI
 * za obecny, wiec klub z nazwa "   " dawal w tytule strony pusty ciag,
 * a stad `FALLBACK_TITLE` ("Klub dyskusyjny") zamiast nazwy w drugim jezyku.
 * `trim` zostaje, bo tytul i opis strony nie moga miec brzegowych spacji.
 */
function pick(lang: Lang, pl: string | null, en: string | null): string {
  return (lang === "en" ? pickPair(en, pl) : pickPair(pl, en)).trim();
}

const FALLBACK_TITLE: Record<Lang, string> = {
  pl: "Klub dyskusyjny",
  en: "Discussion club",
};

const FALLBACK_DESCRIPTION: Record<Lang, string> = {
  pl: "Trwala przestrzen dyskusji czlonkow New European Strategies: watki, stanowiska i materialy w rytmie procesu legislacyjnego.",
  en: "A persistent discussion space for New European Strategies members: threads, positions and resources paced by the legislative process.",
};

export interface ClubHeadInput {
  /** Sciezka wzgledna uzywana, gdy nie da sie odczytac adresu zadania. */
  fallbackPath: string;
  club: ClubHeadSource | null;
  /** Tytul podrzedny - np. tytul watku albo nazwa zakladki. */
  subtitle?: string | null;
  /** Opis podrzedny - np. fragment tresci watku. */
  description?: string | null;
  /** Wymusza `noindex` niezaleznie od widocznosci klubu: kompozytor, formularz
   *  zaproszenia i inne powierzchnie czynnosciowe nie naleza do indeksu nawet
   *  w klubie publicznym. */
  forceNoindex?: boolean;
}

/**
 * Naglowek trasy klubowej. Zwraca deskryptor gotowy dla `head()` TanStacka.
 */
export function buildClubHead(input: ClubHeadInput): ReturnType<typeof buildContentHead> {
  const url = getRequestUrl() || input.fallbackPath;
  const lang = activeLang(url);
  const clubName = input.club ? pick(lang, input.club.namePl, input.club.nameEn) : "";
  const tagline = input.club ? pick(lang, input.club.taglinePl, input.club.taglineEn) : "";

  const subtitle = (input.subtitle ?? "").trim();
  const base = clubName || FALLBACK_TITLE[lang];
  const title = subtitle.length > 0 ? `${subtitle} - ${base}` : base;
  const description = (input.description ?? "").trim() || tagline || FALLBACK_DESCRIPTION[lang];

  const indexable = !input.forceNoindex && isClubIndexable(input.club);

  return buildContentHead({
    url,
    lang,
    type: "website",
    title,
    description,
    image: input.club?.coverImageUrl ?? undefined,
    // Jawny `robots` zamiast flagi `noindex`: klub publiczny ma dostac takze
    // `follow`, zeby link do watku niosl dalej sygnal, a nie konczyl sciezke.
    robots: indexable ? "index, follow" : "noindex, nofollow",
  });
}
