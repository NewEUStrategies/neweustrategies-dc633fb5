// Listwa linków prawnych stopki (regulamin, polityka prywatności, zwroty
// i reklamacje, cookies, RODO...). Linki prawne na KAŻDEJ stronie są wymogiem
// operatora płatności, więc listwa nie zależy od dokumentu buildera stopki -
// treść bierze z kanonicznego rejestru `FOOTER_LINKS` (grupa "legal"), tego
// samego, z którego korzystają JSON-LD i raport kliknięć w stopce.
//
// ── DLACZEGO TEN MODUŁ NIE IMPORTUJE NICZEGO Z APLIKACJI ──────────────────
// Na kliencie listwa jest LENIWYM chunkiem wyspy stopki (`Footer.tsx`), żeby
// nie dokładać ani bajtu do domknięcia bootu strony głównej. Łączenie małych
// chunków (`experimentalMinChunkSize` w `vite.config.ts`) wkleiło ją jednak do
// chunku wejściowego (zmierzone na artefakcie: wejście jest zawsze już
// załadowane, gdy pada `import()` listwy), więc obie konfiguracje Vite dają jej
// nazwany chunk `legal-links`, którego Rollup nie łączy. Nazwany chunk wciąga
// do siebie każdą statyczną zależność spoza INNYCH nazwanych chunków - gdyby
// ten moduł importował coś z aplikacji (np. rejestr linków), wejście
// importowałoby to stamtąd i chunk listwy wróciłby do bootu. Dlatego rejestr
// przychodzi w propsach, a moduł sięga wyłącznie po biblioteki z nazwanych
// chunków vendorowych (React, router, i18next) i po typy. Moduł nie ma też
// efektów ubocznych: na serwerze `Footer.tsx` importuje go statycznie, a w
// bundlu klienta ten import znika (gałąź `import.meta.env.SSR`) tylko dlatego,
// że czysty moduł bez użytych wiązań wolno pominąć.
//
// `Link` routera, nie surowe `<a>`: przepisanie wyjścia routera dokłada prefiks
// języka (`/en/regulamin`), więc ten sam rejestr daje poprawne adresy w PL i EN.
// Geometria (rozmiar pisma, odstępy, wysokość celu) jest wspólna dla motywów -
// zmieniają się wyłącznie kolory z tokenów (`text-muted-foreground`,
// `hover:text-foreground`, `ring-ring`).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { FooterLink } from "@/lib/seo/footerNavigation";

export interface LegalLinksProps {
  /** Rejestr linków stopki (`FOOTER_LINKS`); listwa wybiera z niego grupę "legal". */
  readonly links: readonly FooterLink[];
  readonly lang: "pl" | "en";
  /**
   * Klasy kontenera `<nav>`. Domyślnie wariant stopki: wyśrodkowany rząd pod
   * dokumentem buildera, w szerokości i wcięciu wiersza praw autorskich.
   */
  readonly className?: string;
  /** Klasy listy linków (domyślnie wyśrodkowane, zawijane wiersze). */
  readonly listClassName?: string;
}

// `pb-20` (5rem): listwa jest ostatnią treścią strony, a pływający przycisk
// „Wróć na górę" (`BackToTop`: `fixed bottom-6 right-6 h-11 w-11`, widoczny na
// każdej szerokości po przewinięciu) zajmuje pas 1,5-4,25rem od dołu ekranu
// przy prawej krawędzi. Przy `pb-4` na telefonie (412 px, trzy wiersze) ostatni
// link wiersza (RODO/GDPR) stał pod przyciskiem nawet po przewinięciu do końca:
// stuknięcie trafiało w przycisk, a fokus był zasłonięty (WCAG 2.4.11). 5rem =
// 4,25rem pasa przycisku + 0,75rem luzu; obie miary w rem, więc zapas trzyma
// się przy każdym rozmiarze korzenia. Geometria wspólna dla motywów.
const NAV_CLASS = "mx-auto w-full max-w-[1400px] px-5 pb-20 text-xs text-muted-foreground";
// `gap-y-2`: odstęp między zawiniętymi wierszami (telefon) - cele dotyku nie
// stykają się krawędziami. Na desktopie listwa to jeden wiersz, więc bez zmian.
const LIST_CLASS = "m-0 flex list-none flex-wrap items-center justify-center gap-x-4 gap-y-2 p-0";
// `min-h-6`: cel dotyku 1,5rem (24 px przy korzeniu 16 px; przy płynnym korzeniu
// desktopu ok. 23 px - WCAG 2.5.8 spełnia wtedy wyjątek odstępu `gap-x-4`).
// `focus-visible:underline`: podkreślenie w kolorze tekstu jako drugi sygnał
// fokusu - pierścień z tokenu `--ring` ma w jasnym motywie za mały kontrast
// wobec tła stopki (WCAG 1.4.11), podkreślenie ma kontrast samego tekstu.
const LINK_CLASS =
  "inline-flex min-h-6 items-center rounded-sm underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LegalLinks({
  links,
  lang,
  className = NAV_CLASS,
  listClassName = LIST_CLASS,
}: LegalLinksProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("footer.legal_nav", { lng: lang })} className={className}>
      {/* `role="list"`: Safari/VoiceOver gubi semantykę listy przy `list-none`. */}
      <ul role="list" className={listClassName}>
        {links
          .filter((link) => link.group === "legal")
          .map((link) => (
            <li key={link.href}>
              <Link to={link.href} className={LINK_CLASS}>
                {link.label[lang]}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}

export default LegalLinks;
