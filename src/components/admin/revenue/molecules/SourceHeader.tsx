// Molekuła: „źródło prawdy" bytu, który hub pokazuje albo zmienia (SPEC §3,
// §6.1, §6.4) - kto go edytuje, które pola należą do którego ekranu i gdzie
// jeszcze pojawi się ta sama zmiana.
//
// PO CO. Hub nie ma własnych danych: plan, kupon czy ustawienia newslettera
// mają JEDNO źródło prawdy i ekran-właściciela w module. Szybka naprawa
// w Diagnostyce zapisuje tym samym mutatorem co moduł, więc admin musi
// widzieć, że poprawia TEN SAM wiersz, który zobaczy w Cenniku albo
// w Paywallu - a nie kopię, która rozjedzie się z modułem.
//
// DANE Z MANIFESTU, NIE Z KOMPONENTU. Właściciele, ich kolumny i zakładki
// huba czyta `HUB_SYNC_MANIFEST` (`lib/revenue/syncManifest.ts`) - tę samą
// tabelę, z której Diagnostyka rysuje Mapę systemu i którą test manifestu
// sprawdza z `routeTree.gen.ts`. Nowy właściciel w manifeście bez napisu
// ekranu zapala test tego pliku, zanim admin zobaczy surowy adres.
//
// WYGLĄD `LinkedSourceHeader`, ODNOŚNIK WŁASNY. Ramka, typografia i przycisk
// są słowo w słowo z `components/admin/settings/LinkedSource.tsx` (ten sam
// wzorzec „wartość pochodzi z innego ekranu" w całym panelu). Samego
// komponentu nie da się tu owinąć: przyjmuje adres jako napis i podaje go
// do `<Link to>`, a deep linki SPEC §2.6 niosą zakładkę w `search`
// (`/admin/paywall?tab=metering`) - napis z `?` router potraktowałby jako
// ścieżkę i odnośnik prowadziłby donikąd. Zgłoszenie do integracji:
// `sourceSearch`/`sourceParams` w `LinkedSourceHeader`, wtedy ten plik
// przejdzie na owijkę bez zmiany wyglądu.
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { HUB_SYNC_MANIFEST, type HubEntityId, type HubOwner } from "@/lib/revenue/syncManifest";
import type { RevenueTabId } from "@/lib/revenue/search";

/** Ekrany-właściciele z manifestu - jeden napis na trasę i zakładkę. */
export type OwnerScreenId =
  | "membership"
  | "membership_grants"
  | "pricing_tiers"
  | "pricing_retention"
  | "paywall_plans"
  | "paywall_overrides"
  | "paywall_metering"
  | "paywall_checkout"
  | "post_editor"
  | "coupons"
  | "coupon_campaigns"
  | "profile_subscription"
  | "billing_subscriptions"
  | "billing_orders"
  | "users"
  | "monetization_ledger"
  | "crm"
  | "newsletter"
  | "newsletter_subscribers"
  | "popups"
  | "workflows"
  | "revenue_journeys"
  | "revenue_inputs"
  | "revenue_diagnostics"
  | "event_registrations"
  | "club_applications"
  | "club_page";

/**
 * Klucz ekranu: ścieżka trasy plus zakładka (z `search.tab` albo z parametru
 * `$tab`). Dwie zakładki tej samej trasy (`/admin/paywall?tab=plans`
 * i `?tab=metering`) to dla admina dwa różne miejsca.
 */
function ownerScreenKey(owner: Pick<HubOwner, "to" | "params" | "search">): string {
  const tab = owner.params?.tab ?? owner.search?.tab ?? "";
  return tab === "" ? owner.to : `${owner.to}#${tab}`;
}

/** Ekran-właściciel po kluczu `ownerScreenKey` - komplet pilnuje test manifestu. */
const OWNER_SCREEN: Readonly<Record<string, OwnerScreenId>> = {
  "/admin/membership": "membership",
  "/admin/membership#grants": "membership_grants",
  "/admin/pricing#tiers": "pricing_tiers",
  "/admin/pricing#retention": "pricing_retention",
  "/admin/paywall#plans": "paywall_plans",
  "/admin/paywall#overrides": "paywall_overrides",
  "/admin/paywall#metering": "paywall_metering",
  "/admin/paywall#checkout": "paywall_checkout",
  "/admin/posts/$slug": "post_editor",
  "/admin/coupons": "coupons",
  "/admin/coupons/campaigns": "coupon_campaigns",
  "/profile/subscription": "profile_subscription",
  "/admin/billing#subscriptions": "billing_subscriptions",
  "/admin/billing#orders": "billing_orders",
  "/admin/users": "users",
  "/admin/monetization-ledger": "monetization_ledger",
  "/admin/crm": "crm",
  "/admin/newsletter": "newsletter",
  "/admin/newsletter/subscribers": "newsletter_subscribers",
  "/admin/popups": "popups",
  "/admin/workflows#definitions": "workflows",
  "/admin/revenue/$tab#journeys": "revenue_journeys",
  "/admin/revenue/$tab#inputs": "revenue_inputs",
  "/admin/revenue/$tab#diagnostics": "revenue_diagnostics",
  "/admin/events/registrations": "event_registrations",
  "/admin/community/clubs/applications": "club_applications",
  "/admin/community/clubs/$clubId": "club_page",
};

const SCREEN_LABEL_KEY: Readonly<Record<OwnerScreenId, string>> = {
  membership: "adminRevenue.source.screen.membership",
  membership_grants: "adminRevenue.source.screen.membership_grants",
  pricing_tiers: "adminRevenue.source.screen.pricing_tiers",
  pricing_retention: "adminRevenue.source.screen.pricing_retention",
  paywall_plans: "adminRevenue.source.screen.paywall_plans",
  paywall_overrides: "adminRevenue.source.screen.paywall_overrides",
  paywall_metering: "adminRevenue.source.screen.paywall_metering",
  paywall_checkout: "adminRevenue.source.screen.paywall_checkout",
  post_editor: "adminRevenue.source.screen.post_editor",
  coupons: "adminRevenue.source.screen.coupons",
  coupon_campaigns: "adminRevenue.source.screen.coupon_campaigns",
  profile_subscription: "adminRevenue.source.screen.profile_subscription",
  billing_subscriptions: "adminRevenue.source.screen.billing_subscriptions",
  billing_orders: "adminRevenue.source.screen.billing_orders",
  users: "adminRevenue.source.screen.users",
  monetization_ledger: "adminRevenue.source.screen.monetization_ledger",
  crm: "adminRevenue.source.screen.crm",
  newsletter: "adminRevenue.source.screen.newsletter",
  newsletter_subscribers: "adminRevenue.source.screen.newsletter_subscribers",
  popups: "adminRevenue.source.screen.popups",
  workflows: "adminRevenue.source.screen.workflows",
  revenue_journeys: "adminRevenue.source.screen.revenue_journeys",
  revenue_inputs: "adminRevenue.source.screen.revenue_inputs",
  revenue_diagnostics: "adminRevenue.source.screen.revenue_diagnostics",
  event_registrations: "adminRevenue.source.screen.event_registrations",
  club_applications: "adminRevenue.source.screen.club_applications",
  club_page: "adminRevenue.source.screen.club_page",
};

const ENTITY_LABEL_KEY: Readonly<Record<HubEntityId, string>> = {
  membership_tier: "adminRevenue.source.entity.membership_tier",
  access_plan: "adminRevenue.source.entity.access_plan",
  content_access: "adminRevenue.source.entity.content_access",
  metering: "adminRevenue.source.entity.metering",
  checkout_settings: "adminRevenue.source.entity.checkout_settings",
  coupon: "adminRevenue.source.entity.coupon",
  coupon_campaign: "adminRevenue.source.entity.coupon_campaign",
  retention_settings: "adminRevenue.source.entity.retention_settings",
  retention_flow: "adminRevenue.source.entity.retention_flow",
  provider_subscription: "adminRevenue.source.entity.provider_subscription",
  entitlement: "adminRevenue.source.entity.entitlement",
  membership_grant: "adminRevenue.source.entity.membership_grant",
  billing_document: "adminRevenue.source.entity.billing_document",
  payment_order: "adminRevenue.source.entity.payment_order",
  account: "adminRevenue.source.entity.account",
  paywall_hit: "adminRevenue.source.entity.paywall_hit",
  crm_lead: "adminRevenue.source.entity.crm_lead",
  crm_task: "adminRevenue.source.entity.crm_task",
  newsletter_subscriber: "adminRevenue.source.entity.newsletter_subscriber",
  newsletter_settings: "adminRevenue.source.entity.newsletter_settings",
  workflow: "adminRevenue.source.entity.workflow",
  journey: "adminRevenue.source.entity.journey",
  journey_run: "adminRevenue.source.entity.journey_run",
  event_registration: "adminRevenue.source.entity.event_registration",
  club_application: "adminRevenue.source.entity.club_application",
  club_member: "adminRevenue.source.entity.club_member",
  revenue_input: "adminRevenue.source.entity.revenue_input",
  revenue_diagnostic: "adminRevenue.source.entity.revenue_diagnostic",
};

/** Etykiety zakładek huba - klucze rdzenia I0 (`adminRevenue.tab.*`). */
const TAB_LABEL_KEY: Readonly<Record<RevenueTabId, string>> = {
  overview: "adminRevenue.tab.overview",
  mrr: "adminRevenue.tab.mrr",
  funnel: "adminRevenue.tab.funnel",
  retention: "adminRevenue.tab.retention",
  community: "adminRevenue.tab.community",
  diagnostics: "adminRevenue.tab.diagnostics",
  offer: "adminRevenue.tab.offer",
  access: "adminRevenue.tab.access",
  journeys: "adminRevenue.tab.journeys",
  metrics: "adminRevenue.tab.metrics",
  inputs: "adminRevenue.tab.inputs",
};

/**
 * Konkretny adres właściciela albo `null`, gdy trasa ma parametr bez wartości
 * (`/admin/posts/$slug` - reguła dostępu edytuje się na stronie KAŻDEGO wpisu,
 * więc nie ma jednego miejsca, do którego można prowadzić).
 */
function ownerPath(owner: HubOwner): string | null {
  let unresolved = false;
  const path = owner.to.replace(/\$([A-Za-z_]\w*)/g, (_whole, name: string) => {
    const value = owner.params?.[name];
    if (value === undefined) {
      unresolved = true;
      return "";
    }
    return encodeURIComponent(value);
  });
  return unresolved ? null : path;
}

export interface SourceHeaderProps {
  entity: HubEntityId;
  /**
   * Kolumny, których dotyczy zmiana. Podane - nagłówek pokazuje tylko
   * ekrany-właścicieli tych kolumn (i ekrany edytujące wiersz w całości).
   */
  columns?: readonly string[];
}

export function SourceHeader({ entity, columns }: SourceHeaderProps) {
  ensureRevenueI18n();
  ensureI18n();
  const { t } = useTranslation();
  const spec = HUB_SYNC_MANIFEST.find((e) => e.id === entity);
  const entityLabel = t(ENTITY_LABEL_KEY[entity]);

  const allOwners = spec?.owners ?? [];
  const owners =
    columns && columns.length > 0
      ? allOwners.filter((o) => !o.columns || o.columns.some((c) => columns.includes(c)))
      : allOwners;

  const screenLabel = (owner: HubOwner): string => {
    const id = OWNER_SCREEN[ownerScreenKey(owner)];
    return id ? t(SCREEN_LABEL_KEY[id]) : owner.to;
  };

  // „Ta sama zmiana pojawi się w…" - wszyscy właściciele i zakładki huba,
  // które pokazują byt. Admin poprawiający plan w Diagnostyce widzi, że ta
  // sama liczba zmieni się w Cenniku, Paywallu i na Kokpicie.
  const elsewhere = [
    ...new Set([
      ...allOwners.map(screenLabel),
      ...(spec?.hubTabs ?? []).map((tab) => t(TAB_LABEL_KEY[tab])),
    ]),
  ];

  return (
    <section
      aria-label={t("adminRevenue.source.header", { entity: entityLabel })}
      data-entity={entity}
      className="mb-2 rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs"
    >
      <div className="font-medium text-foreground">
        {t("adminRevenue.source.header", { entity: entityLabel })}
      </div>
      {owners.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{t("adminRevenue.source.systemOnly")}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {owners.map((owner) => {
            const label = screenLabel(owner);
            const path = ownerPath(owner);
            const ownedColumns = owner.columns?.filter((c) => !columns || columns.includes(c));
            return (
              <li key={ownerScreenKey(owner)} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-foreground">
                    {t("adminRevenue.source.ownedBy", { screen: label })}
                  </div>
                  {ownedColumns && ownedColumns.length > 0 ? (
                    <div className="text-muted-foreground truncate font-mono text-[11px]">
                      {t("adminRevenue.source.columns", { columns: ownedColumns.join(", ") })}
                    </div>
                  ) : null}
                </div>
                {path ? (
                  <Link
                    to={path}
                    search={owner.search}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                  >
                    {t("adminRevenue.source.openOwner", { screen: label })}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t("adminRevenue.source.perItem")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {elsewhere.length > 1 ? (
        <p className="mt-1 text-muted-foreground">
          {t("adminRevenue.source.sameChange", { screens: elsewhere.join(", ") })}
        </p>
      ) : null}
    </section>
  );
}
