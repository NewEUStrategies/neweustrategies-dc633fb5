// Organizm: „Mapa systemu" Diagnostyki (SPEC §2.2 `?view=map`, §3.2).
//
// Tabela z `HUB_SYNC_MANIFEST` - tego samego manifestu, z którego naprawy
// biorą nagłówek źródła, a test manifestu sprawdza trasy, tabele, zdarzenia
// i klucze. Wiersz = byt huba: kto go pisze (mutator, funkcja serwera,
// webhook, RPC, wyzwalacz), jakie zdarzenia wysyła i które zakładki huba
// odświeża. Admin, który widzi diagnozę „emiter ucichł", sprawdza tu, CO
// powinno było to zdarzenie wysłać i KTO na nie czeka.
//
// DOSTĘPNOŚĆ: prawdziwa tabela (`caption`, `scope`), a szeroka treść
// w przewijalnym regionie z nazwą i `tabIndex=0` (WCAG 2.1.1 - przewijanie
// z klawiatury), zamiast poziomego paska całej strony.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import type { RevenueTabId } from "@/lib/revenue/search";
import {
  HUB_SYNC_MANIFEST,
  type HubEntity,
  type HubEntityId,
  type HubWriterKind,
} from "@/lib/revenue/syncManifest";

const WRITER_KIND_KEY: Readonly<Record<HubWriterKind, string>> = {
  mutator: "adminRevenue.diagnostics.map.writerKind.mutator",
  server_fn: "adminRevenue.diagnostics.map.writerKind.server_fn",
  webhook: "adminRevenue.diagnostics.map.writerKind.webhook",
  rpc: "adminRevenue.diagnostics.map.writerKind.rpc",
  trigger: "adminRevenue.diagnostics.map.writerKind.trigger",
};

/** Etykiety zakładek - klucze rdzenia I0. */
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

/** Etykieta bytu - klucze nagłówka źródła S6 (`adminRevenue.source.entity.*`). */
function entityKey(id: HubEntityId): string {
  return `adminRevenue.source.entity.${id}`;
}

/** `ścieżka#eksport` → sam eksport; funkcja SQL → nazwa; plik → nazwa pliku. */
export function writerLabel(ref: string): string {
  const hash = ref.indexOf("#");
  if (hash >= 0) return ref.slice(hash + 1);
  const slash = ref.lastIndexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

function ownerText(entity: HubEntity): string[] {
  return entity.owners.map((owner) => {
    const path = owner.params
      ? owner.to.replace(/\$([A-Za-z_]\w*)/g, (_m, name: string) => owner.params?.[name] ?? `$${name}`)
      : owner.to;
    return owner.search?.tab ? `${path}?tab=${owner.search.tab}` : path;
  });
}

export interface SystemMapGridProps {
  entities?: readonly HubEntity[];
}

export function SystemMapGrid({ entities = HUB_SYNC_MANIFEST }: SystemMapGridProps) {
  ensureRevenueI18n();
  ensureShellI18n();
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const none = t("adminRevenue.diagnostics.map.none");

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-[6px] border border-border bg-card p-4">
      <div className="space-y-0.5">
        <h2 id={headingId} className="m-0 text-base font-semibold">
          {t("adminRevenue.diagnostics.map.title")}
        </h2>
        <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.diagnostics.map.description")}</p>
      </div>
      <div
        role="region"
        aria-label={t("adminRevenue.diagnostics.map.scrollRegion")}
        tabIndex={0}
        className="overflow-x-auto rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full min-w-[48rem] border-collapse text-sm" data-testid="system-map">
          <caption className="sr-only">{t("adminRevenue.diagnostics.map.caption")}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminRevenue.diagnostics.map.entity")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminRevenue.diagnostics.map.writers")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminRevenue.diagnostics.map.events")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminRevenue.diagnostics.map.tabs")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("adminRevenue.diagnostics.map.owner")}
              </th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} data-entity={entity.id} className="border-b border-border align-top last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {t(entityKey(entity.id))}
                </th>
                <td className="py-2 pr-3">
                  <ul className="m-0 list-none space-y-0.5 p-0">
                    {entity.writers.map((writer) => (
                      <li key={`${writer.kind}:${writer.ref}`}>
                        <code className="text-xs">{writerLabel(writer.ref)}</code>{" "}
                        <span className="text-xs text-muted-foreground">({t(WRITER_KIND_KEY[writer.kind])})</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="py-2 pr-3">
                  {entity.events.length === 0 ? (
                    none
                  ) : (
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {entity.events.map((event) => (
                        <li key={event}>
                          <code className="text-xs">{event}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {entity.hubTabs.length === 0 ? none : entity.hubTabs.map((tab) => t(TAB_LABEL_KEY[tab])).join(", ")}
                </td>
                <td className="py-2">
                  {entity.owners.length === 0 ? (
                    <span className="text-muted-foreground">{t("adminRevenue.diagnostics.map.systemOnly")}</span>
                  ) : (
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {ownerText(entity).map((path) => (
                        <li key={path}>
                          <code className="text-xs">{path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
