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
// Kolejność odpowiada temu, po co czytelnik wyszukuje markę: najpierw
// formaty redakcyjne (analizy, wywiady), potem wydarzenia i materiały
// eksperckie, na końcu tożsamość wydawcy. „Kontakt" świadomie NIE należy do
// tej listy - zostaje w stopce i na stronie „O nas". Podcast wróci tu, gdy
// /podcasts przestanie zwracać kartę „Nie udało się załadować podcastów"
// (pomiar 2026-10-09: 3/3 odpowiedzi zdegradowane) - sekcja główna nie może
// prowadzić crawlera ani asystenta AI na stronę błędu.
import { FOOTER_LINKS, type FooterLink } from "@/lib/seo/footerNavigation";

export const PRIMARY_SECTION_HREFS = [
  "/analizy",
  "/category/wywiady",
  "/wydarzenia",
  "/category/policy-papers",
  "/o-nas",
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
