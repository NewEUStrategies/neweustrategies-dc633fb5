// Kanoniczna mapa linków stopki wykorzystywana zarówno przez JSON-LD
// (SiteNavigationElement) jak i panel analityczny footer clicks w admin.
// Grupowanie odzwierciedla mega-stopkę: Editorial, Topics, Community,
// Institute + Legal. Etykiety PL/EN muszą pozostać spójne z widocznym UI,
// żeby raporty w GA4/dashboardzie były czytelne bez slug-matchingu.
import type { Lang } from "@/lib/seo/meta";

export type FooterLinkGroup = "editorial" | "topics" | "community" | "institute" | "legal";

export interface FooterLink {
  href: string;
  label: { pl: string; en: string };
  group: FooterLinkGroup;
}

export const FOOTER_LINKS: readonly FooterLink[] = [
  // Editorial
  { group: "editorial", href: "/analizy", label: { pl: "Analizy", en: "Analyses" } },
  { group: "editorial", href: "/category/wywiady", label: { pl: "Wywiady", en: "Interviews" } },
  {
    group: "editorial",
    href: "/category/policy-papers",
    label: { pl: "Policy papers", en: "Policy papers" },
  },
  { group: "editorial", href: "/podcasts", label: { pl: "Podcast", en: "Podcast" } },
  // Topics
  {
    group: "topics",
    href: "/category/geopolityka",
    label: { pl: "Geopolityka", en: "Geopolitics" },
  },
  {
    group: "topics",
    href: "/category/bezpieczenstwo",
    label: { pl: "Bezpieczeństwo", en: "Security" },
  },
  { group: "topics", href: "/category/gospodarka", label: { pl: "Gospodarka", en: "Economy" } },
  { group: "topics", href: "/category/nato", label: { pl: "NATO", en: "NATO" } },
  // Community
  { group: "community", href: "/wydarzenia", label: { pl: "Wydarzenia", en: "Events" } },
  {
    group: "community",
    href: "/spotkania-chatham-house",
    label: { pl: "Spotkania Chatham House", en: "Chatham House meetings" },
  },
  {
    group: "community",
    href: "/dolacz-do-newslettera",
    label: { pl: "Newsletter", en: "Newsletter" },
  },
  { group: "community", href: "/pricing", label: { pl: "Subskrypcje", en: "Subscriptions" } },
  // Institute
  { group: "institute", href: "/o-nas", label: { pl: "O nas", en: "About us" } },
  { group: "institute", href: "/kontakt", label: { pl: "Kontakt", en: "Contact" } },
  { group: "institute", href: "/wspieraj-nas", label: { pl: "Wspieraj nas", en: "Support us" } },
  { group: "institute", href: "/reklamuj-sie-u-nas", label: { pl: "Reklama", en: "Advertise" } },
  // Legal
  { group: "legal", href: "/regulamin", label: { pl: "Regulamin", en: "Terms & conditions" } },
  {
    group: "legal",
    href: "/polityka-prywatnosci",
    label: { pl: "Polityka prywatności", en: "Privacy notice" },
  },
  {
    group: "legal",
    href: "/zwroty-i-reklamacje",
    label: { pl: "Zwroty i reklamacje", en: "Refund policy" },
  },
  { group: "legal", href: "/cookies", label: { pl: "Polityka cookies", en: "Cookie policy" } },
  {
    group: "legal",
    href: "/wytyczne-dotyczace-reklam",
    label: { pl: "Wytyczne reklam", en: "Advertising guidelines" },
  },
  // PASEK PRAWNY JEST PASKIEM, NIE SPISEM TREŚCI. `CopyrightBar` renderuje tę
  // grupę jako jeden `flex-wrap` w cienkiej belce na dole strony. Pakiet
  // zgodności 2026-09 dołożył dziewięć dokumentów; wrzucenie ich tutaj w
  // całości zamieniało belkę w trzywierszową ścianę linków, a na telefonie
  // w jeszcze dłuższą. Dlatego w pasku stoją tylko te, których czytelnik
  // SZUKA po nazwie, a pozostałe są dociągane trzema innymi drogami:
  // sitemapą XML (sekcja `core`), wzajemnym linkowaniem wewnątrz samych
  // dokumentów i stroną /sitemap.
  {
    group: "legal",
    href: "/regulamin-subskrypcji-i-zakupow",
    label: { pl: "Subskrypcje i zakupy", en: "Subscriptions and purchases" },
  },
  { group: "legal", href: "/rodo", label: { pl: "RODO", en: "GDPR" } },
  {
    group: "legal",
    href: "/moderacja-komentarzy",
    label: { pl: "Moderacja treści", en: "Content moderation" },
  },
  // Statut nie jest dokumentem prawnym serwisu, tylko TOŻSAMOŚCIĄ wydawcy -
  // stąd grupa "institute", obok "O nas" i "Kontakt".
  { group: "institute", href: "/statut", label: { pl: "Statut", en: "Statute" } },
];

export function footerLinksByGroup(group: FooterLinkGroup): readonly FooterLink[] {
  return FOOTER_LINKS.filter((l) => l.group === group);
}

export function labelFor(link: FooterLink, lang: Lang): string {
  return lang === "en" ? link.label.en : link.label.pl;
}
