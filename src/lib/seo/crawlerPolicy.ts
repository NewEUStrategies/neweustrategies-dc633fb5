// Polityka crawlerów AI i warunki wykorzystania treści - wejście buildera
// robots.txt (`buildRobotsTxt`) i bloku warunków llms.txt, wyprowadzane
// z redakcyjnych przełączników `/admin/settings/seo`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3). Czytają
// to wyłącznie trasy serwerowe (robots.txt, llms.txt) i podgląd w panelu
// (`RobotsTxtPreview`), a `settings.ts` jest w chunku startowym klienta (head()
// strony głównej i wpisu czyta `parseSeoSettings`). Dopóki te funkcje mieszkały
// w `settings.ts`, jego import `robots.ts` wciągał do `app-initial` cały builder
// robots.txt (ok. 2,5 KB surowego kodu), choć przeglądarka czytelnika nigdy go
// nie woła. `settings.ts` NIE importuje stąd niczego - także reeksportem.
import {
  ROBOTS_DEFAULT_DISALLOW,
  type RobotsGroup,
  type RobotsUsagePolicy,
} from "@/lib/seo/robots";
import { effectiveSiteName, type SeoSettings } from "@/lib/seo/settings";

/**
 * AI/LLM crawlers relevant to Generative Engine Optimization. Search-assistant
 * crawlers (OAI-SearchBot, PerplexityBot, ClaudeBot) drive citations and
 * zero-click brand visibility; training crawlers (GPTBot, CCBot, ...) only
 * feed model training. The policy lets a publisher stay visible in AI answers
 * while opting out of training if that is the editorial stance.
 */
export const AI_SEARCH_CRAWLERS: readonly string[] = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "DuckAssistBot",
];

export const AI_TRAINING_CRAWLERS: readonly string[] = [
  "GPTBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "cohere-training-data-crawler",
];

/**
 * Grupy robots.txt wynikające z redakcyjnej polityki crawlerów AI.
 *
 * Zwraca STRUKTURY, nie linie tekstu: składanie pliku należy do jednego
 * buildera (`buildRobotsTxt`), więc format grupy nie może się rozjechać między
 * polityką AI a resztą pliku. Poprzednia wersja zwracała gotowe linie i - co
 * ważniejsze - nikt jej nie wołał: przełączniki z `/admin/settings/seo`
 * nie docierały do robots.txt w ogóle (audyt 2026-08-06).
 */
export function aiCrawlerGroups(settings: SeoSettings): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  if (settings.ai_search_crawlers_allowed) {
    // ZGODA JAWNA, nie milcząca. Grupa `*` wystarczyłaby technicznie, ale bot
    // AI dopasowuje najpierw grupę ze SWOJĄ nazwą - własna grupa jest jedynym
    // miejscem, w którym warunek cytowania stoi obok reguły, którą ten konkretny
    // bot faktycznie stosuje.
    groups.push({
      agents: AI_SEARCH_CRAWLERS,
      allow: ["/"],
      disallow: ROBOTS_DEFAULT_DISALLOW,
      contentSignal: `search=yes, ai-input=yes, ai-train=${
        settings.ai_training_crawlers_allowed ? "yes" : "no"
      }`,
      comments: [
        "AI search assistants: crawling and quoting allowed, attribution REQUIRED -",
        "name the source and link the article URL you quote.",
      ],
    });
  } else {
    groups.push({ agents: AI_SEARCH_CRAWLERS, disallow: ["/"] });
  }
  if (settings.ai_training_crawlers_allowed) {
    // `ai-input` grupy treningowej idzie za przełącznikiem CYTOWANIA, nie jest
    // stałym `yes`: bot dopasowuje wyłącznie swoją grupę, więc stałe
    // `ai-input=yes` dawało GPTBotowi i spółce zgodę na użycie treści
    // w odpowiedziach AI, której redakcja odmówiła (grupa `*` i llms.txt
    // mówiły `ai-input=no`) - plik przeczył sam sobie.
    const aiInput = settings.ai_search_crawlers_allowed ? "yes" : "no";
    groups.push({
      agents: AI_TRAINING_CRAWLERS,
      allow: ["/"],
      disallow: ROBOTS_DEFAULT_DISALLOW,
      contentSignal: `search=yes, ai-input=${aiInput}, ai-train=yes`,
      comments: settings.ai_search_crawlers_allowed
        ? ["Training crawlers: allowed under the attribution terms above."]
        : [
            "Training crawlers: training allowed under the attribution terms above;",
            "use in AI answers is not permitted (ai-input=no).",
          ],
    });
  } else {
    groups.push({ agents: AI_TRAINING_CRAWLERS, disallow: ["/"] });
  }
  return groups;
}

/**
 * Warunki wykorzystania treści - wprost z redakcyjnych przełączników, żeby plik
 * nie obiecywał czegoś innego niż panel. JEDNO źródło dla robots.txt
 * (`renderUsagePolicy` + `Content-Signal`) i llms.txt (nazwa źródła i zgody
 * w bloku warunków): oba pliki jednego hosta nie mogą stawiać dwóch różnych
 * warunków atrybucji ani udzielać zgody, której drugi odmawia.
 */
export function robotsUsagePolicy(settings: SeoSettings): RobotsUsagePolicy {
  return {
    siteName: effectiveSiteName(settings),
    // Wyłączony llms.txt odpowiada 404 - robots.txt nie może go wskazywać
    // jako pełnych warunków.
    termsPath: settings.llms_txt_enabled ? "/llms.txt" : null,
    trainingAllowed: settings.ai_training_crawlers_allowed,
    aiInputAllowed: settings.ai_search_crawlers_allowed,
  };
}
