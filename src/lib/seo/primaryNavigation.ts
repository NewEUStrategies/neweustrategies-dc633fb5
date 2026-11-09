// KOLEJNOŚĆ SEKCJI GŁÓWNYCH serwisu - jedno źródło dla tego, co serwis sam
// deklaruje jako swoje najważniejsze podstrony: JSON-LD strony głównej,
// llms.txt i podgląd w panelu SEO.
//
// CZEGO TA LISTA NIE ROBI. Google nie ma przełącznika sitelinków i nie
// dokumentuje używania `SiteNavigationElement` do ich wyboru - sitelinki
// powstają automatycznie, z analizy struktury linków wewnętrznych
// (https://developers.google.com/search/docs/appearance/sitelinks). Realnym
// sygnałem są więc linki `<a href>` w HTML-u: menu nagłówka (od 2026-10 pozycje
// z panelem niosą w HTML-u serwera ukryte lustro linków, `SiteMenu.tsx`)
// i stopka. Ta lista jest spójną deklaracją dla innych konsumentów danych
// strukturalnych i asystentów AI - nie zastępuje linków.
//
// PO CO OSOBNA LISTA, SKORO JEST `FOOTER_LINKS`. Do 2026-10 strona główna
// deklarowała jako nawigację CAŁĄ mapę stopki: 25 linków płasko, razem
// z dokumentami prawnymi, „Kontaktem" i „Reklamą" - deklaracja bez hierarchii.
// Ta lista jest WYBOREM I KOLEJNOŚCIĄ, a nie drugim rejestrem: etykiety
// i adresy pochodzą z `FOOTER_LINKS`, więc nazwa sekcji w stopce, w JSON-LD,
// w llms.txt i w panelu SEO nie może się rozjechać. Test kontraktu pilnuje,
// że każdy adres stąd istnieje w mapie stopki.
//
// KOLEJNOŚĆ (decyzja redakcji 2026-11-08). Pięć sekcji, które redakcja chce
// widzieć pod wynikiem na nazwę marki - i w tej kolejności: Analizy, O nas,
// Konferencje, Spotkania (Chatham House), Wywiady. Wcześniejsza lista (analizy,
// wywiady, wydarzenia, policy papers, podcast, o nas) nie obejmowała
// konferencji ani spotkań, a Google dobierał na sitelink stronę techniczną
// „Customize Interests" (teraz `noindex` - `lib/seo/utilityPages.ts`).
// „Kontakt" świadomie NIE należy do tej listy - zostaje w stopce i na stronie
// „O nas". Wydarzenia, policy papers i podcast zostają w stopce i w mapie
// strony; nie są już deklarowane jako sekcje główne.
//
// Lista nie gwarantuje sitelinków (patrz wyżej), ale archiwum bez treści nie
// zostanie wybrane nigdy: `/category/wywiady` jest dla Google sitelinkiem
// dopiero wtedy, gdy wpisy-wywiady mają przypisaną kategorię „Wywiady" -
// llms.txt pomija puste archiwum (`resolvePrimarySectionHref`).
import { FOOTER_LINKS, type FooterLink } from "@/lib/seo/footerNavigation";

export const PRIMARY_SECTION_HREFS = [
  "/analizy",
  "/o-nas",
  "/konferencje",
  "/spotkania-chatham-house",
  "/category/wywiady",
] as const;

/** Sekcje główne w zaplanowanej kolejności, z etykietami z mapy stopki. */
export function primarySiteSections(): FooterLink[] {
  const out: FooterLink[] = [];
  for (const href of PRIMARY_SECTION_HREFS) {
    const link = FOOTER_LINKS.find((l) => l.href === href);
    if (link) out.push(link);
  }
  return out;
}
