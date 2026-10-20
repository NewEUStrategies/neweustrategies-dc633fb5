// Zakładka „Ścieżki” huba (`/admin/revenue/journeys`) - właściciel S8.
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc lista,
// galeria, dialogi i słownik S8 jadą we własnym chunku dopiero po wejściu na
// zakładkę (budżet: kod panelu leniwie, `public` bez zmian).
//
// CO TU JEST (SPEC §2.2, §6.3): pasek zdrowia silnika, lista ścieżek z filtrem
// statusu i wyszukiwaniem w adresie (`?status=`, `?q=`), galeria szablonów
// (`?new=1`, wybór `?template=<klucz>` walidowany względem
// `JOURNEY_TEMPLATE_KEYS`), tworzenie ścieżki i ustawienia silnika. Zakładka
// przestała renderować `RevenueTabPreparing` - wpis w `TAB_PREPARING` zdejmuje
// integrator (manifest I9).
//
// ADRES CZYTAMY Z UKŁADU HUBA. `validateSearch` stoi tylko na układzie
// (`parseRevenueHubSearch`, I0), więc zakładka czyta `useSearch({ from:
// "/admin/revenue" })` i zmienia go `useNavigate()` jak `RevenueHubLayout`.
// Nieznany `?template=` jest ignorowany (galeria otwarta bez wyboru), a
// szablon niedostępny nie otwiera instalacji - karta mówi, dlaczego.
//
// TREŚĆ PO HYDRATACJI (`useHydrated`): serwer nie zna sesji, więc do
// hydratacji obie strony rysują stan „wczytywanie” - bez różnic SSR/klient.
//
// TRZY STANY ZAMIAST TREŚCI: brak `aal2` (`mfa_required` z middleware) ->
// `MfaRequiredNotice`; brak roli -> `RoleGateNotice`; funkcje silnika jeszcze
// niewdrożone (`unavailable`) -> komunikat z następnym krokiem. Pusta lista bez
// filtra -> galeria jako stan pusty („zacznij od szablonu”).
import { useState } from "react";
import { useHydrated, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  JourneyCreateDialog,
  type JourneyCreateMode,
} from "@/components/admin/journeys/list/JourneyCreateDialog";
import { JourneyEngineHealthStrip } from "@/components/admin/journeys/list/JourneyEngineHealthStrip";
import { JourneyList } from "@/components/admin/journeys/list/JourneyList";
import { JourneySettingsDialog } from "@/components/admin/journeys/list/JourneySettingsDialog";
import { JourneyTemplateGallery } from "@/components/admin/journeys/list/JourneyTemplateGallery";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { journeyAccessDenial, journeyCapabilities } from "@/lib/admin/journeys/access";
import { journeyTemplateCatalogQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import { journeyListQueryOptions } from "@/lib/journeys/queries";
import { JOURNEY_TEMPLATE_KEYS, type JourneyTemplateKey } from "@/lib/journeys/templates/types";
import type { RevenueHubSearch } from "@/lib/revenue/search";

function isTemplateKey(value: string | undefined): value is JourneyTemplateKey {
  return value !== undefined && (JOURNEY_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function RevenueJourneysTab() {
  ensureJourneysI18n();
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-journeys" className="space-y-4">
      {hydrated ? <JourneysTabContent /> : <RevenueTabPending />}
    </div>
  );
}

function JourneysTabContent() {
  const { t } = useTranslation();
  const { roles, tenantId } = useAuth();
  // Atrapa sesji w testach I0 nie podaje najemcy - `undefined` = brak najemcy.
  const tenant = tenantId ?? null;
  const caps = journeyCapabilities(roles);
  const search = useSearch({ from: "/admin/revenue" });
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);

  const list = useQuery({
    ...journeyListQueryOptions(tenant, null),
    enabled: Boolean(tenant) && caps.canEdit,
  });
  const items = list.data?.state === "ready" ? list.data.data : null;
  const emptyAll = items !== null && items.length === 0;
  const galleryOpen = search.new === "1" || emptyAll;
  const catalog = useQuery({
    ...journeyTemplateCatalogQueryOptions(tenant),
    enabled: Boolean(tenant) && caps.canEdit && galleryOpen,
  });

  if (!caps.canEdit) return <RoleGateNotice requiredRole="admin_or_editor" />;
  const denial = journeyAccessDenial(list.error ?? catalog.error);
  if (mfaRequired || denial === "mfa_required") return <MfaRequiredNotice />;
  if (denial === "role" || list.data?.state === "forbidden") {
    return <RoleGateNotice requiredRole="admin_or_editor" />;
  }
  if (list.data?.state === "unavailable") return <EngineUnavailable />;

  /** Zmiana adresu zakładki; `replace` przy pisaniu w polu szukania. */
  const setSearch = (patch: Partial<RevenueHubSearch>, replace = false) => {
    const next: RevenueHubSearch = { ...search, ...patch };
    for (const key of Object.keys(next) as (keyof RevenueHubSearch)[]) {
      if (next[key] === undefined) delete next[key];
    }
    void navigate({
      to: "/admin/revenue/$tab",
      params: { tab: "journeys" },
      search: next,
      replace,
    });
  };

  const entries = catalog.data ?? null;
  const templateParam = isTemplateKey(search.template) ? search.template : null;
  const selectedEntry =
    templateParam !== null && galleryOpen
      ? (entries?.find((entry) => entry.key === templateParam) ?? null)
      : null;
  // Szablon niedostępny z adresu NIE otwiera instalacji (karta pokazuje powód).
  const createMode: JourneyCreateMode | null = blankOpen
    ? { kind: "blank" }
    : selectedEntry && selectedEntry.availability.status === "available"
      ? { kind: "template", entry: selectedEntry }
      : null;
  const installedKeys = new Set(
    (items ?? []).flatMap((item) =>
      item.status !== "archived" && item.templateKey !== null ? [item.templateKey] : [],
    ),
  );
  const existingKeys = new Set((items ?? []).map((item) => item.key));

  return (
    <>
      <JourneyEngineHealthStrip
        tenantId={tenant}
        canManageEngine={caps.canManageEngine}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {galleryOpen ? (
        <JourneyTemplateGallery
          catalog={entries}
          isLoading={catalog.isLoading}
          isError={catalog.isError}
          onRetry={() => void catalog.refetch()}
          installedKeys={installedKeys}
          selectedKey={templateParam}
          onSelect={(key) => setSearch({ new: "1", template: key })}
          onBlank={() => setBlankOpen(true)}
          onClose={emptyAll ? undefined : () => setSearch({ new: undefined, template: undefined })}
        />
      ) : null}

      <div data-tour="journeys-list">
        <RevenueSection
          titleKey="adminJourneys.list.title"
          descriptionKey="adminJourneys.list.description"
          actions={
            <Button type="button" size="sm" className="h-7" onClick={() => setSearch({ new: "1" })}>
              {t("adminJourneys.list.newJourney")}
            </Button>
          }
        >
          <JourneyList
            items={items}
            isLoading={list.isLoading}
            errorMessage={list.isError ? t("adminJourneys.list.loadError") : null}
            status={search.status ?? null}
            query={search.q ?? ""}
            onStatusChange={(next) => setSearch({ status: next ?? undefined })}
            onQueryChange={(next) => setSearch({ q: next === "" ? undefined : next }, true)}
            tenantId={tenant}
            canChangeStatus={caps.canPublish}
            emptyLabel={t("adminJourneys.list.empty")}
            onMfaRequired={() => setMfaRequired(true)}
          />
        </RevenueSection>
      </div>

      <JourneyCreateDialog
        mode={createMode}
        tenantId={tenant}
        existingKeys={existingKeys}
        onOpenChange={(open) => {
          if (open) return;
          setBlankOpen(false);
          if (search.template !== undefined) setSearch({ template: undefined });
        }}
        onCreated={(journeyId) => {
          setBlankOpen(false);
          void navigate({ to: "/admin/revenue/journeys/$journeyId", params: { journeyId } });
        }}
      />

      <JourneySettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tenantId={tenant}
        canManage={caps.canManageEngine}
      />
    </>
  );
}

function EngineUnavailable() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      data-testid="journeys-unavailable"
      className="space-y-1 rounded-[6px] border border-border bg-muted/30 p-4 text-sm"
    >
      <p className="m-0 flex items-center gap-2 font-semibold text-foreground">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("adminJourneys.list.unavailableTitle")}
      </p>
      <p className="m-0 text-muted-foreground">{t("adminJourneys.list.unavailableBody")}</p>
      <p className="m-0 text-muted-foreground">{t("adminJourneys.list.unavailableNext")}</p>
    </div>
  );
}
