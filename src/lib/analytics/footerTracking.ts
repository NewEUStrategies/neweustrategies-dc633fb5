// Klikalne linki w stopce - podwójny beacon (analytics_events przez nasz
// /api/public/track + GA4 gtag na kliencie, jesli skrypt zostal wczytany po
// zgodzie marketingowej z ConsentScriptInjector). Kazde zdarzenie respektuje
// RODO: track() sam sprawdza analytics-consent, a window.gtag istnieje tylko
// gdy uzytkownik wyrazil zgode marketingowa. Nazwy zdarzen sa stabilne, zeby
// panel admin/analytics -> footer mogl je zgrupowac bez migracji.
import { track } from "@/lib/analytics/track";
import type { FooterLinkGroup } from "@/lib/seo/footerNavigation";

type GtagFn = (
  command: "event",
  name: string,
  params?: Record<string, unknown>,
) => void;

function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
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
  const g = gtag();
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
  const g = gtag();
  if (g) {
    g("event", "footer_newsletter_signup", { status, ...(meta ?? {}) });
  }
}
