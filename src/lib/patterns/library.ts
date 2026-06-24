// Built-in starter patterns for pages and posts. Pure data, no DB.
// Apply via PatternPicker which clones+edits before persisting.
import type { BuilderDocument, SectionNode, ColumnNode, WidgetNode } from "@/lib/builder/types";
import { newId } from "@/lib/builder/types";
import type { Pattern } from "./types";

const w = (type: WidgetNode["type"], content: WidgetNode["content"]): WidgetNode => ({
  id: newId(), kind: "widget", type, content,
});
const c = (span: number, children: WidgetNode[]): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children,
});
const s = (children: ColumnNode[], opts: Partial<SectionNode> = {}): SectionNode => ({
  id: newId(), kind: "section", children, ...opts,
});

// ---------------- PAGE PATTERNS ----------------

const landingHeroDoc = (): BuilderDocument => ({
  version: 1,
  sections: [
    s([
      c(12, [
        w("heading", {
          text_pl: "Zbuduj coś, co ma znaczenie",
          text_en: "Build something that matters",
          tag: "h1", variant: "default", sizePreset: "display",
        }),
        w("text", {
          html_pl: "<p>Krótki, sugestywny opis tego, co oferujesz. Pokaż wartość w jednym zdaniu.</p>",
          html_en: "<p>A short, suggestive description of what you offer. Show the value in one sentence.</p>",
        }),
        w("button", {
          label_pl: "Zacznij teraz", label_en: "Get started",
          href: "/pricing", variant: "primary", size: "lg",
        }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140, verticalAlign: "middle" },
         style: { padding: { desktop: "96px 24px" }, align: { desktop: "center" } } }),
    s([
      c(4, [w("heading", { text_pl: "Szybkość", text_en: "Speed", tag: "h3", sizePreset: "md" }),
            w("text", { html_pl: "<p>Lekki kod, natychmiastowa reakcja.</p>", html_en: "<p>Lean code, instant response.</p>" })]),
      c(4, [w("heading", { text_pl: "Stabilność", text_en: "Stability", tag: "h3", sizePreset: "md" }),
            w("text", { html_pl: "<p>Sprawdzone wzorce i testy.</p>", html_en: "<p>Proven patterns and tests.</p>" })]),
      c(4, [w("heading", { text_pl: "Skalowalność", text_en: "Scalability", tag: "h3", sizePreset: "md" }),
            w("text", { html_pl: "<p>Architektura, która rośnie z Tobą.</p>", html_en: "<p>Architecture that grows with you.</p>" })]),
    ], { layout: { contentWidth: "boxed", width: 1140 }, style: { padding: { desktop: "64px 24px" } } }),
    s([
      c(12, [
        w("cta", {
          title_pl: "Gotowy, by zacząć?", title_en: "Ready to start?",
          cta_pl: "Skontaktuj się", cta_en: "Contact us",
          href: "/contact",
        }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140 }, style: { padding: { desktop: "64px 24px" } } }),
  ],
});

const aboutTwoColumnDoc = (): BuilderDocument => ({
  version: 1,
  sections: [
    s([
      c(6, [
        w("heading", {
          text_pl: "O nas", text_en: "About us",
          tag: "h1", sizePreset: "xl",
        }),
        w("text", {
          html_pl: "<p>Jesteśmy zespołem, który łączy strategię z technologią. Pracujemy z klientami, którym zależy na trwałych efektach.</p>",
          html_en: "<p>We are a team that joins strategy with technology. We work with clients who care about lasting impact.</p>",
        }),
      ]),
      c(6, [
        w("image", { src: "", alt_pl: "Zespół", alt_en: "Team" }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140, verticalAlign: "middle" },
         style: { padding: { desktop: "80px 24px" } } }),
    s([
      c(12, [
        w("heading", { text_pl: "Co robimy", text_en: "What we do", tag: "h2", sizePreset: "lg" }),
        w("accordion", {
          items: [
            { q_pl: "Strategia", q_en: "Strategy", a_pl: "Diagnoza, cele, mapa drogowa.", a_en: "Discovery, goals, roadmap." },
            { q_pl: "Produkt", q_en: "Product", a_pl: "Projekt, prototypy, walidacja.", a_en: "Design, prototypes, validation." },
            { q_pl: "Wdrożenie", q_en: "Implementation", a_pl: "Iteracyjny rozwój, jakość, wsparcie.", a_en: "Iterative delivery, quality, support." },
          ],
        }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140 }, style: { padding: { desktop: "64px 24px" } } }),
  ],
});

const pricingThreeColDoc = (): BuilderDocument => ({
  version: 1,
  sections: [
    s([
      c(12, [
        w("heading", { text_pl: "Cennik", text_en: "Pricing", tag: "h1", sizePreset: "xl" }),
        w("text", { html_pl: "<p>Wybierz plan dopasowany do Twoich potrzeb.</p>", html_en: "<p>Choose the plan that fits your needs.</p>" }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140 },
         style: { padding: { desktop: "80px 24px 24px" }, align: { desktop: "center" } } }),
    s([
      c(12, [
        w("pricing", {
          plans: [
            { name_pl: "Start", name_en: "Starter", price: "0", currency: "PLN",
              period_pl: "/mies.", period_en: "/mo",
              features_pl: ["Podstawowe funkcje", "1 użytkownik"],
              features_en: ["Core features", "1 user"],
              cta_pl: "Wybierz", cta_en: "Choose", href: "/checkout/starter", featured: false },
            { name_pl: "Pro", name_en: "Pro", price: "49", currency: "PLN",
              period_pl: "/mies.", period_en: "/mo",
              features_pl: ["Wszystko ze Start", "Wsparcie 24/7"],
              features_en: ["Everything in Starter", "24/7 support"],
              cta_pl: "Wybierz", cta_en: "Choose", href: "/checkout/pro", featured: true },
            { name_pl: "Enterprise", name_en: "Enterprise", price: "199", currency: "PLN",
              period_pl: "/mies.", period_en: "/mo",
              features_pl: ["Wszystko z Pro", "SLA + onboarding"],
              features_en: ["Everything in Pro", "SLA + onboarding"],
              cta_pl: "Kontakt", cta_en: "Contact", href: "/contact", featured: false },
          ],
        }),
      ]),
    ], { layout: { contentWidth: "boxed", width: 1140 }, style: { padding: { desktop: "32px 24px 96px" } } }),
  ],
});

// ---------------- POST PATTERNS ----------------

const articleBasicPL = `<p><em>Wprowadzenie - jednym akapitem oddaj to, dlaczego ten tekst powstał.</em></p>
<h2>Tło</h2>
<p>Opisz kontekst, w którym dzieje się sprawa. Postaw fakty obok siebie i pozwól im wybrzmieć.</p>
<h2>Analiza</h2>
<p>Co z tego wynika? Wyciągnij dwa-trzy wnioski i poprzyj je danymi.</p>
<h2>Co dalej</h2>
<p>Jakie są scenariusze rozwoju? Zamknij tekst krótką rekomendacją.</p>`;
const articleBasicEN = `<p><em>Introduction - say in one paragraph why this article exists.</em></p>
<h2>Background</h2>
<p>Lay out the context. Place the facts next to each other and let them speak.</p>
<h2>Analysis</h2>
<p>What does it mean? Draw two or three conclusions and back them with data.</p>
<h2>What's next</h2>
<p>What scenarios are likely? Close with a short recommendation.</p>`;

const longformPL = `<p class="lead">Tekst dłuższy - rozłóż argumentację w kilku rozdziałach.</p>
<h2>1. Diagnoza</h2><p>...</p>
<h2>2. Mechanizmy</h2><p>...</p>
<h2>3. Konsekwencje</h2><p>...</p>
<h2>4. Rekomendacje</h2><p>...</p>
<blockquote>Cytat lub puenta, która zostanie z czytelnikiem.</blockquote>`;
const longformEN = `<p class="lead">A longer piece - lay out the argument across several chapters.</p>
<h2>1. Diagnosis</h2><p>...</p>
<h2>2. Mechanisms</h2><p>...</p>
<h2>3. Consequences</h2><p>...</p>
<h2>4. Recommendations</h2><p>...</p>
<blockquote>A pull quote that stays with the reader.</blockquote>`;

// ---------------- EXPORTED LIBRARY ----------------

export const PATTERNS: Pattern[] = [
  {
    id: "page.landing.hero",
    kind: "page",
    category: "landing",
    name: { pl: "Landing - bohater + cechy + CTA", en: "Landing - hero + features + CTA" },
    description: {
      pl: "Klasyczny układ marketingowy: nagłówek, trzy filary i wezwanie do akcji.",
      en: "Classic marketing layout: headline, three pillars, call to action.",
    },
    defaultTitle: { pl: "Strona główna", en: "Home" },
    builder: landingHeroDoc(),
  },
  {
    id: "page.about.two-column",
    kind: "page",
    category: "about",
    name: { pl: "O nas - dwie kolumny + FAQ", en: "About - two columns + FAQ" },
    description: {
      pl: "Tekst po lewej, obraz po prawej, sekcja zwijanego FAQ poniżej.",
      en: "Text on the left, image on the right, collapsible FAQ below.",
    },
    defaultTitle: { pl: "O nas", en: "About us" },
    builder: aboutTwoColumnDoc(),
  },
  {
    id: "page.pricing.three-col",
    kind: "page",
    category: "pricing",
    name: { pl: "Cennik - trzy plany", en: "Pricing - three plans" },
    description: {
      pl: "Trzy plany cenowe z wyróżnionym środkowym + nagłówek.",
      en: "Three pricing plans with a highlighted middle tier + heading.",
    },
    defaultTitle: { pl: "Cennik", en: "Pricing" },
    builder: pricingThreeColDoc(),
  },
  {
    id: "post.article.basic",
    kind: "post",
    category: "article",
    name: { pl: "Artykuł - klasyczny układ", en: "Article - classic layout" },
    description: {
      pl: "Wprowadzenie, tło, analiza i wniosek - 4 sekcje.",
      en: "Intro, background, analysis, conclusion - 4 sections.",
    },
    defaultTitle: { pl: "Nowy artykuł", en: "New article" },
    defaultExcerpt: {
      pl: "Krótki opis zachęcający do przeczytania.",
      en: "A short hook that invites the read.",
    },
    content: { pl: articleBasicPL, en: articleBasicEN },
  },
  {
    id: "post.longform",
    kind: "post",
    category: "longform",
    name: { pl: "Longform - 4 rozdziały + cytat", en: "Longform - 4 chapters + pull quote" },
    description: {
      pl: "Pogłębiona forma na 4 rozdziały z cytatem na końcu.",
      en: "An in-depth format with 4 chapters and a closing pull quote.",
    },
    defaultTitle: { pl: "Pogłębiona analiza", en: "In-depth analysis" },
    content: { pl: longformPL, en: longformEN },
  },
];

export const PAGE_PATTERNS = PATTERNS.filter((p): p is Extract<Pattern, { kind: "page" }> => p.kind === "page");
export const POST_PATTERNS = PATTERNS.filter((p): p is Extract<Pattern, { kind: "post" }> => p.kind === "post");

export function findPattern(id: string): Pattern | undefined {
  return PATTERNS.find((p) => p.id === id);
}
