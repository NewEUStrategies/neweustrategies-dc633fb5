// KOLEJNOŚĆ SEKCJI GŁÓWNYCH serwisu - jedno źródło dla wszystkiego, co mówi
// wyszukiwarkom i asystentom AI, które podstrony są dla marki najważniejsze.
//
// PO CO OSOBNA LISTA, SKORO JEST `FOOTER_LINKS`. Do 2026-10 strona główna
// emitowała jako `SiteNavigationElement` CAŁĄ mapę stopki: 25 linków płasko,
// razem z dokumentami prawnymi, „Kontaktem" i „Reklamą". Google buduje
// sitelinki algorytmicznie (nie ma przełącznika, który by je ustawiał), ale
// czyta przy tym strukturę linków i to, co serwis sam deklaruje jako
// nawigację. Płaska lista, w której „Kontakt" stoi obok „Wywiadów", nie mówi
// nic o hierarchii - a w wynikach na nazwę marki pojawiały się „O nas",
// „Kontakt" i ekran błędu sieci zamiast sekcji redakcyjnych.
//
// Ta lista jest WYBOREM I KOLEJNOŚCIĄ, a nie drugim rejestrem: etykiety
// i adresy pochodzą z `FOOTER_LINKS`, więc nazwa sekcji w stopce, w JSON-LD,
// w llms.txt i w panelu SEO nie może się rozjechać. Test kontraktu pilnuje,
// że każdy adres stąd istnieje w mapie stopki.
//
// Kolejność odpowiada temu, po co czytelnik wyszukuje markę: najpierw
// formaty redakcyjne (analizy, wywiady), potem wydarzenia, materiały
// eksperckie i podcast, na końcu tożsamość wydawcy. „Kontakt" świadomie
// NIE należy do tej listy - zostaje w stopce i na stronie „O nas".
import { FOOTER_LINKS, type FooterLink } from "@/lib/seo/footerNavigation";

export const PRIMARY_SECTION_HREFS = [
  "/analizy",
  "/category/wywiady",
  "/wydarzenia",
  "/category/policy-papers",
  "/podcasts",
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
