// Klikalne linki w stopce - podwójny beacon (analytics_events przez nasz
// /api/public/track + GA4 gtag na kliencie, jeśli skrypt został wczytany po
// zgodzie ANALITYCZNEJ z ConsentScriptInjector). Nazwy zdarzeń są stabilne,
// żeby panel admin/analytics -> footer mógł je zgrupować bez migracji.
//
// RODO: bramka zgody `analytics` stoi przed OBOMA kanałami wyjścia. Własny
// beacon bramkuje `track()` (sam czyta `hasAnalyticsConsent()`), a jedyną
// drogą do GA4 w tym module jest `gtagIfConsented()` - patrz komentarz przy
// tej funkcji. Wcześniejsze założenie („window.gtag istnieje tylko po zgodzie
// marketingowej") było nieprawdziwe w dwóch miejscach naraz: GA4 wstrzykuje
// `loadAnalytics()` pod kategorią ANALYTICS, a sprzątanie (`removeMarked`)
// usuwa element <script>, nie globalną funkcję, którą ten skrypt zdefiniował.
import { track } from "@/lib/analytics/track";
import { hasAnalyticsConsent } from "@/lib/ads/consent";
import type { FooterLinkGroup } from "@/lib/seo/footerNavigation";

type GtagFn = (command: "event", name: string, params?: Record<string, unknown>) => void;

/**
 * Jedyne wejście do GA4 w tym module - i równocześnie BRAMKA ZGODY drugiego
 * kanału wyjścia. Zwraca `null` (czyli „nie nadawaj"), gdy nie ma zgody
 * `analytics` albo gdy sygnał GPC jest honorowany; `hasAnalyticsConsent()`
 * czyta jedno źródło prawdy razem z klamrą GPC, więc pomiar nie może się
 * rozjechać z tym, co CMP pokazuje użytkownikowi.
 *
 * DLACZEGO BRAMKA JEST TUTAJ, A NIE PRZY KAŻDYM `g("event", …)`. Oba warianty
 * dają dziś ten sam skutek, ale różnią się trwałością. Bramka rozsypana po
 * miejscach wywołania jest bramką „do zapamiętania": dopisanie w przyszłości
 * trzeciego zdarzenia stopki wymagałoby powtórzenia warunku, a jego pominięcie
 * przechodzi przez tsc, lintera i recenzję - i wraca jako naruszenie prawa,
 * nie jako awaria. Skoro `window.gtag` jest w tym module osiągalny WYŁĄCZNIE
 * przez ten akcesor, bramka w akcesorze obejmuje z definicji każde nadanie,
 * także to dopisane później.
 *
 * DLACZEGO NIE NEUTRALIZUJEMY SAMEJ `window.gtag` (podmiana na no-op przy
 * cofnięciu zgody). Byłoby to szczelniejsze globalnie, ale nie należy do tego
 * modułu i wprowadza trzy nowe problemy: (1) `window.gtag` należy do snippetu
 * GA4 wstrzykiwanego przez `ConsentScriptInjector`, więc nadpisanie go
 * odbierałoby GA4 własny tryb zgody i wyścigowałoby się z ponownym
 * wstrzyknięciem skryptu po powtórnym udzieleniu zgody; (2) skutek uboczny
 * spadłby na WSZYSTKICH nadawców (np. `googleSourceBadgeAnalytics`), którzy
 * o takiej podmianie nic nie wiedzą - cicha zmiana zachowania cudzego kodu;
 * (3) `dataLayer` przeżyłby podmianę, więc szczelność byłaby pozorna. Bramka
 * czytana przy każdym nadaniu jest za to natychmiastowa: działa też wtedy, gdy
 * zgoda zostaje cofnięta W TRAKCIE sesji, bo nie ma tu żadnego cache'u.
 */
function gtagIfConsented(): GtagFn | null {
  if (typeof window === "undefined") return null;
  if (!hasAnalyticsConsent()) return null;
  const w = window as unknown as { gtag?: GtagFn };
  return typeof w.gtag === "function" ? w.gtag : null;
}

export interface FooterClickPayload {
  href: string;
  label: string;
  group: FooterLinkGroup | "unknown";
  external?: boolean;
}

/**
 * Uniwersalny helper dla kliknieć w linki stopki. `event_name` mapuje na trzy
 * kategorie widoczne w dashboardzie: footer_link_click (default),
 * footer_legal_click, footer_newsletter_click.
 */
export function trackFooterLink(payload: FooterClickPayload): void {
  const eventName =
    payload.group === "legal"
      ? "footer_legal_click"
      : payload.href.includes("newsletter") || payload.href.includes("dolacz-do-newslettera")
        ? "footer_newsletter_click"
        : "footer_link_click";
  const meta = {
    href: payload.href,
    label: payload.label,
    group: payload.group,
    external: Boolean(payload.external),
  };
  track({
    type: "cta_click",
    name: eventName,
    entityType: "menu",
    entityId: payload.href,
    meta,
  });
  const g = gtagIfConsented();
  if (g) {
    g("event", eventName, {
      link_url: payload.href,
      link_text: payload.label,
      link_group: payload.group,
      outbound: Boolean(payload.external),
    });
  }
}

export function trackFooterNewsletterSubmit(
  status: "success" | "error" | "throttled",
  meta?: Record<string, unknown>,
): void {
  track({
    type: "cta_click",
    name: "footer_newsletter_signup",
    entityType: "cta",
    entityId: "footer_newsletter",
    meta: { status, ...(meta ?? {}) },
  });
  const g = gtagIfConsented();
  if (g) {
    g("event", "footer_newsletter_signup", { status, ...(meta ?? {}) });
  }
}
