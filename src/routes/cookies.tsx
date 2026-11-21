// Publiczna polityka plików cookies + centrum preferencji (RODO/ePrivacy).
// URL: /cookies. Treść dwujęzyczna (PL/EN) - lang wybierany przez activeLang().
// Centrum preferencji jest już wdrożone w ConsentBanner; ta strona linkuje do
// niego przez event OPEN_PREFS_EVENT i pokazuje aktualny stan zgód.
import { createFileRoute } from "@tanstack/react-router";
import { Cookie, ShieldCheck, Settings, BarChart3, Megaphone, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import {
  staticPageSeoQueryOptions,
  pickStaticSeo,
  LEGAL_SSR_BUDGET_MS,
  NO_STATIC_SEO,
} from "@/lib/queries/staticPageSeo";
import { loadResilient } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { staticFallbackCacheControl } from "@/lib/http/cachePolicy";
import { requestConsentPreferences, useConsent, type ConsentCategory } from "@/lib/ads/consent";
import { DATA_ELEMENT_REGISTRY } from "@/lib/cookieBanner/registry";
import { PRIVACY_UPDATED } from "@/lib/legal/entity";

interface CategoryCopy {
  key: ConsentCategory;
  Icon: typeof Cookie;
  toneBg: string;
  toneText: string;
  toneBorder: string;
  name: { pl: string; en: string };
  desc: { pl: string; en: string };
  examples: { pl: string[]; en: string[] };
  required?: boolean;
}

const CATEGORIES: ReadonlyArray<CategoryCopy> = [
  {
    key: "necessary",
    Icon: Lock,
    toneBg: "bg-brand-ink/10",
    toneText: "text-brand-ink",
    toneBorder: "border-brand-ink/30",
    required: true,
    name: { pl: "Niezbędne", en: "Necessary" },
    desc: {
      pl: "Zapewniają podstawowe działanie platformy - sesja użytkownika, bezpieczeństwo (CSRF), zapamiętanie zgód. Nie można ich wyłączyć na podstawie art. 5 ust. 3 dyrektywy ePrivacy.",
      en: "Provide the basic functionality of the platform - user session, security (CSRF), consent memory. Cannot be disabled under Article 5(3) of the ePrivacy Directive.",
    },
    examples: {
      pl: ["consent:v2 + nes_cookie_consent (zapis zgód)", "sb-*-auth-token (sesja)", "nes_lang", "cf_clearance"],
      en: ["consent:v2 + nes_cookie_consent (consent record)", "sb-*-auth-token (session)", "nes_lang", "cf_clearance"],
    },
  },
  {
    key: "functional",
    Icon: Settings,
    toneBg: "bg-cat-transport/10",
    toneText: "text-cat-transport",
    toneBorder: "border-cat-transport/30",
    name: { pl: "Funkcjonalne", en: "Functional" },
    desc: {
      pl: "Zapamiętują Twoje preferencje: język, motyw kolorystyczny, układ. Dane trzymamy lokalnie w przeglądarce, bez transmisji do podmiotów trzecich.",
      en: "Remember your preferences: language, colour theme, layout. Data stays locally in your browser without transmission to third parties.",
    },
    examples: {
      pl: ["theme", "lang", "reading-history (localStorage)"],
      en: ["theme", "lang", "reading-history (localStorage)"],
    },
  },
  {
    key: "analytics",
    Icon: BarChart3,
    toneBg: "bg-cat-finance/10",
    toneText: "text-cat-finance",
    toneBorder: "border-cat-finance/30",
    name: { pl: "Analityczne", en: "Analytics" },
    desc: {
      pl: "Pokazują, jak korzystasz z serwisu: odwiedzane strony, źródła wejść, czas wizyty, kliknięcia, mapy przewijania i nagrania sesji (wpisywane treści są maskowane). Uruchamiamy je dopiero po Twojej zgodzie. Bez niej działa wyłącznie pomiar bez plików cookie opisany niżej.",
      en: "Show how you use the site: pages visited, traffic sources, visit duration, clicks, scroll maps and session recordings (typed input is masked). They start only after your consent. Without it only the cookieless measurement described below runs.",
    },
    examples: {
      pl: [
        "Google Analytics 4 (_ga, _ga_*)",
        "Microsoft Clarity (_clck, _clsk)",
        "post_views (własna baza, w tym czas aktywnego czytania wpisu)",
        "nes.event-funnel.sent (sessionStorage, lejek wydarzenia)",
      ],
      en: [
        "Google Analytics 4 (_ga, _ga_*)",
        "Microsoft Clarity (_clck, _clsk)",
        "post_views (own database, including active reading time on the article)",
        "nes.event-funnel.sent (sessionStorage, event funnel)",
      ],
    },
  },
  {
    key: "marketing",
    Icon: Megaphone,
    toneBg: "bg-cat-cyber/10",
    toneText: "text-cat-cyber",
    toneBorder: "border-cat-cyber/30",
    name: { pl: "Marketingowe", en: "Marketing" },
    desc: {
      pl: "Mierzą skuteczność naszych reklam w Google, na Facebooku, Instagramie i LinkedIn oraz pozwalają pokazywać reklamy osobom, które odwiedziły serwis. Dostawcy otrzymują identyfikatory z plików cookie, odwiedzane adresy i wykonane działania (np. zapis, zakup z kwotą). Uruchamiamy je wyłącznie po zgodzie marketingowej.",
      en: "Measure how our ads on Google, Facebook, Instagram and LinkedIn perform and let us show ads to people who have visited the site. Providers receive cookie identifiers, the addresses you visit and the actions you take (e.g. a sign-up, a purchase with its value). Loaded only after marketing consent.",
    },
    examples: {
      pl: [
        "Meta Pixel (_fbp, _fbc)",
        "Google Ads (_gcl_au, _gcl_aw)",
        "LinkedIn Insight (li_fat_id, li_sugr, bcookie, lidc)",
        "nes.attribution.v1 (localStorage, atrybucja kampanii, 90 dni)",
      ],
      en: [
        "Meta Pixel (_fbp, _fbc)",
        "Google Ads (_gcl_au, _gcl_aw)",
        "LinkedIn Insight (li_fat_id, li_sugr, bcookie, lidc)",
        "nes.attribution.v1 (localStorage, campaign attribution, 90 days)",
      ],
    },
  },
];

const COPY = {
  pl: {
    title: "Polityka plików cookies",
    description:
      "Wyjaśniamy, jakich plików cookie i podobnych technologii używamy, jakie masz prawa i jak w każdej chwili zmienić swoje decyzje.",
    intro:
      "Traktujemy Twoją prywatność serio. Zgodnie z RODO i dyrektywą ePrivacy pliki cookie inne niż niezbędne uruchamiamy dopiero po Twojej wyraźnej zgodzie. Poniższa tabela pokazuje wszystkie kategorie i konkretne przykłady.",
    statusHeading: "Twoje aktualne wybory",
    statusUndecided: "Nie zapisano jeszcze wyboru - decyzja pojawi się po interakcji z bannerem.",
    manage: "Zarządzaj preferencjami",
    acceptAll: "Akceptuj wszystkie",
    rejectAll: "Tylko niezbędne",
    examplesLabel: "Przykłady",
    requiredLabel: "Wymagane",
    granted: "Włączone",
    denied: "Wyłączone",
    rightsHeading: "Twoje prawa",
    rights: [
      "Prawo do wycofania zgody w dowolnym momencie (bez wpływu na zgodność z prawem wcześniejszego przetwarzania).",
      "Prawo dostępu do danych, ich sprostowania, usunięcia i ograniczenia przetwarzania.",
      "Prawo do przenoszenia danych i wniesienia sprzeciwu.",
      "Prawo do wniesienia skargi do Prezesa UODO.",
    ],
    contactHeading: "Kontakt",
    contactBody:
      "W sprawach związanych z prywatnością napisz do nas na adres kontaktowy podany w polityce prywatności.",
    updated: `Ostatnia aktualizacja: ${PRIVACY_UPDATED}`,
    cookielessHeading: "Pomiar bez plików cookie",
    cookieless: [
      "Każdą wizytę liczy też wbudowana analityka naszego dostawcy hostingu (Lovable). Nie używa plików cookie, niczego nie zapisuje na Twoim urządzeniu, nie przechowuje adresów IP i nie ustala, kim jesteś.",
      "Rejestruje odwiedzane strony, źródło wejścia, kraj, przeglądarkę, system i typ urządzenia, czas na stronie, szybkość ładowania, błędy, a także kliknięcia i zdarzenia serwisu.",
      "Kliknięcia i zdarzenia serwisu wysyła dopiero po zgodzie na pliki analityczne. Odsłony, czas na stronie, szybkość i błędy liczy u każdego odwiedzającego, bez plików cookie i bez identyfikacji. Gdy Twoja przeglądarka wysyła sygnał Global Privacy Control, kliknięcia i zdarzenia nie są wysyłane nawet po akceptacji.",
      "Dane szczegółowe są przechowywane 90 dni, a dzienne podsumowania - rok. Lovable zbiera te dane w naszym imieniu. Jak je przetwarza, opisuje polityka prywatności Lovable: https://lovable.dev/privacy.",
    ],
    choiceHeading: "Jak działa Twój wybór",
    choice: [
      "Przed decyzją wszystkie kategorie poza niezbędnymi są wyłączone, a znaczniki Google działają w trybie odmowy (Consent Mode). Zamknięcie lub zignorowanie banera niczego nie włącza.",
      "Zgody analityczna i marketingowa są niezależne - jedna nie zastępuje drugiej. Wybór zapisujemy w przeglądarce do 12 miesięcy; zmienisz go w każdej chwili.",
      "Wycofanie zgody zatrzymuje wysyłkę danych od razu, także w innych otwartych kartach. Pliki cookie zapisane wcześniej przez dostawców możesz usunąć w ustawieniach przeglądarki.",
      "Sygnał Global Privacy Control traktujemy jak odmowę zgody na pliki analityczne i marketingowe.",
    ],
    tableHeading: "Szczegółowa lista plików cookie i podmiotów",
    tableName: "Nazwa",
    tableParty: "Podmiot",
    tablePurpose: "Cel",
    tableTtl: "Okres",
    vendorsHeading: "Polityki prywatności dostawców",
    vendorsLead:
      "Meta i LinkedIn są naszymi współadministratorami w zakresie zbierania danych przez ich piksele (art. 26 RODO); dalsze przetwarzanie prowadzą jako samodzielni administratorzy. Przekazanie danych do USA opiera się na unijno-amerykańskich ramach ochrony danych (EU-US Data Privacy Framework) albo standardowych klauzulach umownych.",
  },
  en: {
    title: "Cookie policy",
    description:
      "We explain which cookies and similar technologies we use, what your rights are and how to change your decisions at any time.",
    intro:
      "We take your privacy seriously. Under GDPR and the ePrivacy Directive we activate cookies other than necessary only after your explicit consent. The table below lists every category and concrete examples.",
    statusHeading: "Your current choices",
    statusUndecided: "No choice saved yet - it will appear after you interact with the banner.",
    manage: "Manage preferences",
    acceptAll: "Accept all",
    rejectAll: "Necessary only",
    examplesLabel: "Examples",
    requiredLabel: "Required",
    granted: "Enabled",
    denied: "Disabled",
    rightsHeading: "Your rights",
    rights: [
      "Right to withdraw consent at any time (without affecting the lawfulness of prior processing).",
      "Right to access, rectify, erase and restrict processing.",
      "Right to data portability and to object.",
      "Right to lodge a complaint with the supervisory authority.",
    ],
    contactHeading: "Contact",
    contactBody:
      "For privacy matters, write to us at the contact address given in the privacy policy.",
    updated: `Last updated: ${PRIVACY_UPDATED}`,
    cookielessHeading: "Cookieless measurement",
    cookieless: [
      "Every visit is also counted by the built-in analytics of our hosting provider (Lovable). It uses no cookies, stores nothing on your device, does not keep IP addresses and does not identify you.",
      "It records the pages visited, where visitors came from, their country, browser, operating system and device type, time on page, page load speed, errors, as well as clicks and site events.",
      "Clicks and site events are sent only after you accept analytics cookies. Page views, time on page, page speed and errors are counted for every visitor, without cookies and without identifying anyone. When your browser sends the Global Privacy Control signal, clicks and events are never sent, even after you accept.",
      "Detailed data is kept for 90 days and daily summaries for a year. Lovable collects this data for us. Lovable's privacy policy explains how it handles it: https://lovable.dev/privacy.",
    ],
    choiceHeading: "How your choice works",
    choice: [
      "Before you decide, every category except necessary is off and Google tags run in denied mode (Consent Mode). Closing or ignoring the banner grants nothing.",
      "Analytics and marketing consents are independent - one never stands in for the other. Your choice is saved in your browser for up to 12 months; you can change it at any time.",
      "Withdrawing consent stops data from being sent immediately, also in your other open tabs. Cookies already set by providers can be deleted in your browser settings.",
      "We treat the Global Privacy Control signal as a refusal of analytics and marketing cookies.",
    ],
    tableHeading: "Detailed list of cookies and entities",
    tableName: "Name",
    tableParty: "Entity",
    tablePurpose: "Purpose",
    tableTtl: "Duration",
    vendorsHeading: "Provider privacy policies",
    vendorsLead:
      "Meta and LinkedIn are our joint controllers for the collection of data through their pixels (Article 26 GDPR); they carry out any further processing as independent controllers. Transfers to the US rely on the EU-US Data Privacy Framework or on standard contractual clauses.",
  },
} as const;

const VENDOR_LINKS: ReadonlyArray<{ name: string; href: string }> = [
  { name: "Google (Analytics, Ads)", href: "https://policies.google.com/privacy" },
  { name: "Microsoft (Clarity)", href: "https://privacy.microsoft.com/privacystatement" },
  { name: "Meta (Facebook, Instagram)", href: "https://www.facebook.com/privacy/policy/" },
  { name: "LinkedIn", href: "https://www.linkedin.com/legal/privacy-policy" },
  { name: "Lovable", href: "https://lovable.dev/privacy" },
  { name: "Stripe", href: "https://stripe.com/privacy" },
];

export const Route = createFileRoute("/cookies")({
  component: CookiesPage,
  loader: async ({ context }) => {
    // Krótki termin (F10): to wyłącznie nadpisania SEO z /admin/pages - treść
    // strony żyje w kodzie, więc brak wiersza nie jest warunkiem renderu.
    const seo = await loadResilient(
      context.queryClient,
      staticPageSeoQueryOptions("cookies"),
      NO_STATIC_SEO,
      { deadlineAt: Date.now() + LEGAL_SSR_BUDGET_MS, label: "legal-seo:cookies" },
    );
    // Brak nadpisań SEO daje dokument KOMPLETNY dla czytelnika, tylko
    // niekanoniczny dla brzegu - stąd krótka świeżość z rewalidacją zamiast
    // `no-store` (różnica wobec `resilientCacheControl`: docblock helpera).
    if (import.meta.env.SSR || import.meta.env.DEV)
      setCacheControlHeader(staticFallbackCacheControl(seo.degraded));
    return { seo: seo.data };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/cookies";
    const lang = activeLang(url);
    const c = COPY[lang];
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title:
        lang === "en"
          ? "Cookie policy - New European Strategies"
          : "Polityka plików cookies - New European Strategies",
      description: c.description,
    });
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: seo.title,
      description: seo.description,
      image: seo.image ?? undefined,
      robots: seo.noindex ? "noindex,nofollow" : undefined,
      canonicalOverride: seo.canonical ?? undefined,
    });
  },
});

function CookiesPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/cookies";
  const lang = activeLang(url);
  const c = COPY[lang];
  const { state, acceptAll, rejectAll } = useConsent();

  const openPrefs = () => {
    // Helper odkłada żądanie w stanie modułu, więc klik działa także zanim
    // leniwy chunk ConsentBanner zdąży się pobrać i zasubskrybować.
    requestConsentPreferences();
  };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-10">
      <header className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-ink/10 text-brand-ink px-3 py-1 text-xs font-medium ring-1 ring-brand-ink/30">
          <Cookie className="h-3.5 w-3.5" />
          {lang === "en" ? "Transparency" : "Transparentność"}
        </div>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">{c.title}</h1>
        <p className="text-muted-foreground max-w-2xl">{c.description}</p>
        <p className="text-sm text-muted-foreground max-w-2xl">{c.intro}</p>
        <p className="text-xs text-muted-foreground">{c.updated}</p>
      </header>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-lg">{c.statusHeading}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => rejectAll()}>
              {c.rejectAll}
            </Button>
            <Button size="sm" variant="outline" onClick={() => acceptAll()}>
              {c.acceptAll}
            </Button>
            <Button size="sm" onClick={openPrefs}>
              {c.manage}
            </Button>
          </div>
        </div>
        {!state ? (
          <p className="text-sm text-muted-foreground">{c.statusUndecided}</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CATEGORIES.map((cat) => {
              const granted = state.categories[cat.key];
              return (
                <li
                  key={cat.key}
                  className={`rounded-md border ${cat.toneBorder} ${cat.toneBg} px-3 py-2`}
                >
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${cat.toneText}`}>
                    <cat.Icon className="h-3.5 w-3.5" />
                    {cat.name[lang]}
                  </div>
                  <div className="mt-1 text-sm">{granted ? c.granted : c.denied}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <section className="space-y-4">
        {CATEGORIES.map((cat) => (
          <Card key={cat.key} className={`p-5 border ${cat.toneBorder}`}>
            <div className="flex items-start gap-4">
              <span
                className={`shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md ${cat.toneBg} ${cat.toneText} ring-1 ${cat.toneBorder}`}
                aria-hidden
              >
                <cat.Icon className="h-5 w-5" />
              </span>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg">{cat.name[lang]}</h3>
                  {cat.required && <Badge variant="outline">{c.requiredLabel}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{cat.desc[lang]}</p>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{c.examplesLabel}:</span>{" "}
                  <span className="font-mono">{cat.examples[lang].join(" · ")}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-display text-lg mb-2">{c.choiceHeading}</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
            {c.choice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-lg mb-2">{c.cookielessHeading}</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
            {c.cookieless.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="cookies-table-heading">
        <h2 id="cookies-table-heading" className="font-display text-xl">
          {c.tableHeading}
        </h2>
        {CATEGORIES.map((cat) => {
          const rows = DATA_ELEMENT_REGISTRY.filter((entry) => entry.category === cat.key);
          if (rows.length === 0) return null;
          return (
            <Card key={cat.key} className="p-0 overflow-hidden">
              <h3
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${cat.toneText} ${cat.toneBg}`}
              >
                <cat.Icon className="h-4 w-4" aria-hidden />
                {cat.name[lang]}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 py-2 font-medium">
                        {c.tableName}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {c.tableParty}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {c.tablePurpose}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                        {c.tableTtl}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name} className="border-b border-border last:border-b-0 align-top">
                        <td className="px-4 py-2 font-mono break-words">{row.name}</td>
                        <td className="px-4 py-2">{lang === "en" ? row.party_en : row.party_pl}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {lang === "en" ? row.purpose_en : row.purpose_pl}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {lang === "en" ? row.ttl_en : row.ttl_pl}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </section>

      <Card className="p-5 space-y-3">
        <h2 className="font-display text-lg">{c.vendorsHeading}</h2>
        <p className="text-sm text-muted-foreground">{c.vendorsLead}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {VENDOR_LINKS.map((v) => (
            <li key={v.href}>
              <a
                href={v.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-brand-ink"
              >
                {v.name}
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-display text-lg mb-2">{c.rightsHeading}</h3>
          <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
            {c.rights.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-display text-lg mb-2">{c.contactHeading}</h3>
          <p className="text-sm text-muted-foreground">{c.contactBody}</p>
        </Card>
      </section>
    </main>
  );
}
