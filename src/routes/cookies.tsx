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
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { OPEN_PREFS_EVENT, useConsent, type ConsentCategory } from "@/lib/ads/consent";

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
      pl: ["nes_cookie_consent", "sb-*-auth-token (sesja)", "cf_clearance"],
      en: ["nes_cookie_consent", "sb-*-auth-token (session)", "cf_clearance"],
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
      pl: "Zbierają zanonimizowane statystyki (odsłony, źródła ruchu, czas sesji), które służą optymalizacji treści. Nic z tego nie działa przed wyrażeniem zgody.",
      en: "Collect anonymised statistics (pageviews, traffic sources, session duration) used to improve content. None of it runs before you consent.",
    },
    examples: {
      pl: ["Google Analytics 4 (_ga, _gid)", "post_views (własna baza)"],
      en: ["Google Analytics 4 (_ga, _gid)", "post_views (own database)"],
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
      pl: "Umożliwiają personalizację reklam i pomiar skuteczności kampanii. Uruchamiamy tylko po Twojej zgodzie i wyłącznie w kategoriach, które wskażesz.",
      en: "Enable ad personalisation and campaign measurement. Loaded only after your consent and only for the categories you approve.",
    },
    examples: {
      pl: ["Meta pixel", "LinkedIn Insight", "Google Ads"],
      en: ["Meta pixel", "LinkedIn Insight", "Google Ads"],
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
      "W sprawach związanych z prywatnością napisz do nas na adres inspektora ochrony danych podany w polityce prywatności.",
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
      "For privacy matters, write to us at the data protection officer address given in the privacy policy.",
  },
} as const;

export const Route = createFileRoute("/cookies")({
  component: CookiesPage,
  loader: async ({ context }) => {
    const seo = await context.queryClient
      .ensureQueryData(staticPageSeoQueryOptions("cookies"))
      .catch(() => null);
    return { seo };
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
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(OPEN_PREFS_EVENT));
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
      </header>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-lg">{c.statusHeading}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={rejectAll}>
              {c.rejectAll}
            </Button>
            <Button size="sm" variant="outline" onClick={acceptAll}>
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
