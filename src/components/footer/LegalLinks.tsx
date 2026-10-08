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

const NAV_CLASS = "mx-auto w-full max-w-[1400px] px-5 pb-4 text-xs text-muted-foreground";
const LIST_CLASS = "m-0 flex list-none flex-wrap items-center justify-center gap-x-4 p-0";
// `min-h-6`: cel dotyku 24 px (WCAG 2.5.8) przy piśmie `text-xs`.
const LINK_CLASS =
  "inline-flex min-h-6 items-center rounded-sm underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LegalLinks({
  links,
  lang,
  className = NAV_CLASS,
  listClassName = LIST_CLASS,
}: LegalLinksProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("footer.legal_nav", { lng: lang })} className={className}>
      <ul className={listClassName}>
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
