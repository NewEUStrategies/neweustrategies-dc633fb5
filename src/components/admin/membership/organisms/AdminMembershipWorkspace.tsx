// Organizm: cały panel warstw członkostwa.
//
// Cztery obszary w zakładkach:
//   Katalog warstw    ranga, status i bramki (rdzeń warstwy),
//   Mapowanie planów  `access_plans.tier_key` - co klient dostaje za zakup,
//   Nadania           członkostwo poza planem (darowizna, faktura, import),
//   Organizacje       skok do panelu organizacji i uzgodnienie z Confluence.
//
// PODZIAŁ WŁASNOŚCI KOLUMN (S1 def. 11, `syncManifest.ts`). Ten panel pisze
// WYŁĄCZNIE rdzeń warstwy (`useSaveTierCore`: ranga, bramki, aktywność,
// domyślność) i przypięcie planu (`useSaveAccessPlanPatch("membership")`:
// tylko `tier_key`). Nazwy, opisy i benefity należą do Cennika - tutaj są do
// odczytu z odnośnikiem. Dawniej panel zapisywał całą warstwę i przy okazji
// zmiany rangi cofał benefity ustawione w Cenniku, a zapis mapowania nie znał
// tokenu - cena zmieniona w Paywallu i przypięcie zmienione tutaj nadpisywały
// się nawzajem bez śladu. Teraz oba zapisy idą patchem z tokenem `updated_at`,
// a cudzy zapis po naszym odczycie to jawny konflikt (`40001`) z akcją
// „Wczytaj aktualne".
//
// ADRES = STAN (SPEC §2.6). Trasa podaje zakładkę (`?tab=`) i klucz otwartej
// warstwy (`?tier=`) i zapisuje wybór z powrotem. Bez propsów (test organizmu,
// osadzenie bez routera) oba żyją w stanie komponentu.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Gift, Landmark, Layers, ShieldCheck, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/admin/membership/atoms/KpiTile";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import { NewTierDialog } from "@/components/admin/membership/molecules/NewTierDialog";
import { PlanTierMappingList } from "@/components/admin/membership/molecules/PlanTierMappingList";
import { TierSummaryCard } from "@/components/admin/membership/molecules/TierSummaryCard";
import { adminMembershipGrantsQueryOptions } from "@/components/admin/membership/grantsQuery";
import { GrantsSection } from "@/components/admin/membership/organisms/GrantsSection";
import { TierEditorDialog } from "@/components/admin/membership/organisms/TierEditorDialog";
import {
  coreDraftFromTier,
  corePatch,
  rebaseCoreDraft,
  type TierCoreDraft,
} from "@/components/admin/membership/tierCoreDraft";
import { ConfluenceReconciliationCard } from "@/components/admin/pricing/ConfluenceReconciliationCard";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { InvalidFeaturesJsonError } from "@/lib/admin/membershipDrafts";
import { isMembershipTab, type MembershipTabId } from "@/lib/admin/pricingTabs";
import { summarizeCapabilities } from "@/lib/admin/membership/capabilityModel";
import {
  adminPlansAllQueryOptions,
  useSaveAccessPlanPatch,
  type AccessPlanRow,
} from "@/lib/billing/planQueries";
import {
  useCreateTier,
  useDeleteTier,
  useSaveTierCore,
  type MembershipTierRow,
  type TierCorePatch,
} from "@/lib/billing/tierMutations";
import { parseTierBenefits } from "@/lib/billing/tiers";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import { toastError } from "@/lib/toastError";

const TAB_TRIGGER =
  "h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8";

/**
 * Szkic rdzenia razem z wierszem, na którym admin zaczął edycję. Baza jest
 * zamrożona w szkicu: odświeżenie katalogu (szyna, druga karta) NIE podmienia
 * tokenu pod niezapisanymi zmianami - inaczej zapis przeszedłby bez konfliktu
 * i nadpisał cudzą zmianę, której admin nie widział.
 */
interface TierEdit {
  base: MembershipTierRow;
  draft: TierCoreDraft;
}

/** Szkic różni się od bazy; niedokończony JSON bramek to też zmiana (zapis powie, co jest nie tak). */
function editIsDirty(edit: TierEdit | null): boolean {
  if (!edit) return false;
  try {
    return Object.keys(corePatch(edit.draft, edit.base)).length > 0;
  } catch {
    return true;
  }
}

export function AdminMembershipWorkspace({
  tab,
  onTabChange,
  tierKey,
  onTierKeyChange,
}: {
  /** Zakładka z `?tab=`; brak = stan lokalny (domyślnie katalog warstw). */
  tab?: MembershipTabId;
  onTabChange?: (tab: MembershipTabId) => void;
  /** Klucz warstwy z `?tier=` - otwiera jej edytor. */
  tierKey?: string | null;
  onTierKeyChange?: (key: string | null) => void;
} = {}) {
  // Konflikt zapisu mówi słowami wspólnego słownika synchronizacji S1.
  ensurePaywallSyncI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const qc = useQueryClient();

  const tiersQ = useQuery(adminMembershipTiersQueryOptions());
  // WSZYSTKIE plany (także nieaktywne i wycofane) - ten sam wpis cache co
  // katalog w Paywallu, więc zmiana ceny tam odświeża tę listę i odwrotnie.
  const plansQ = useQuery(adminPlansAllQueryOptions());
  const grantsPreviewQ = useQuery(adminMembershipGrantsQueryOptions());

  const saveTierM = useSaveTierCore();
  const deleteTierM = useDeleteTier();
  const createTierM = useCreateTier();
  const savePlanTierM = useSaveAccessPlanPatch("membership");

  const [edits, setEdits] = useState<Record<string, TierEdit>>({});
  const [localTab, setLocalTab] = useState<MembershipTabId>("tiers");
  // Klucz otwartej warstwy trzymamy też lokalnie: adres przyjmuje klucze
  // `[a-z0-9_]`, a formularz nowej warstwy dopuszcza myślnik - okno musi się
  // otworzyć także wtedy, gdy adresu nie da się takim kluczem zapisać.
  const [localKey, setLocalKey] = useState<string | null>(null);
  const activeTab = tab ?? localTab;
  const editingKey = localKey ?? tierKey ?? null;

  const selectTab = (next: string) => {
    if (!isMembershipTab(next)) return;
    setLocalTab(next);
    onTabChange?.(next);
  };
  const openTier = (key: string | null) => {
    setLocalKey(key);
    onTierKeyChange?.(key);
  };

  const tierOptions = useMemo(
    () => (tiersQ.data ?? []).filter((tier) => tier.active),
    [tiersQ.data],
  );
  const tiers = tiersQ.data ?? [];
  const plans = plansQ.data ?? [];
  const activeTiersCount = tiers.filter((tt) => tt.active).length;
  const defaultTier = tiers.find((tt) => tt.is_default);
  const mappedPlansCount = plans.filter((p) => p.tier_key).length;
  const activeGrantsCount = (grantsPreviewQ.data ?? []).filter((g) => !g.revoked_at).length;

  const editingRow = tiers.find((tt) => tt.key === editingKey) ?? null;
  const editing: TierEdit | null = editingRow
    ? (edits[editingRow.id] ?? { base: editingRow, draft: coreDraftFromTier(editingRow) })
    : null;

  const dropEdit = (id: string) =>
    setEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  // „Wczytaj aktualne" po konflikcie: świeży wiersz staje się nową bazą (nowy
  // token), a pola zmienione przez admina są nakładane na niego.
  const reloadTier = async (id: string, key: string) => {
    try {
      const rows = await qc.fetchQuery({ ...adminMembershipTiersQueryOptions(), staleTime: 0 });
      const fresh = rows.find((row) => row.id === id);
      if (!fresh) {
        dropEdit(id);
        toast.error(tm("editDialog.notFound", { key }));
        return;
      }
      setEdits((current) => {
        const edit = current[id];
        if (!edit) return current;
        return {
          ...current,
          [id]: { base: fresh, draft: rebaseCoreDraft(edit.draft, edit.base, fresh) },
        };
      });
      toast.info(t("adminPaywall.sync.reloaded"));
    } catch (err) {
      toastError(err, "load");
    }
  };

  const saveTier = async (edit: TierEdit) => {
    let patch: TierCorePatch;
    try {
      patch = corePatch(edit.draft, edit.base);
    } catch (err) {
      // Niepoprawny JSON PRZERYWA zapis - warstwa z połamanymi bramkami nie
      // otwiera nic, za co klient zapłacił. Zero zapytań do bazy.
      if (err instanceof InvalidFeaturesJsonError) {
        toast.error(tm("toast.featuresInvalid"));
        return;
      }
      throw err;
    }
    if (Object.keys(patch).length === 0) return;
    try {
      await saveTierM.mutateAsync({
        id: edit.base.id,
        expectedUpdatedAt: edit.base.updated_at,
        patch,
      });
      toast.success(tm("toast.tierSaved"));
      dropEdit(edit.base.id);
    } catch (err) {
      showSaveError(err, t, () => void reloadTier(edit.base.id, edit.base.key));
    }
  };

  const deleteTier = async (row: MembershipTierRow) => {
    openTier(null);
    try {
      await deleteTierM.mutateAsync({ id: row.id });
      toast.success(tm("toast.tierDeleted"));
      dropEdit(row.id);
    } catch (err) {
      toastError(err, "delete");
    }
  };

  const createTier = async (input: {
    key: string;
    rank: number;
    name_pl: string;
    name_en: string;
  }) => {
    try {
      await createTierM.mutateAsync(input);
      toast.success(tm("toast.tierCreated"));
    } catch (err) {
      // Najemca z SESJI (S1 def. 13) - dawniej brany z pierwszej warstwy, więc
      // pusty katalog blokował utworzenie pierwszej. `tenant_unresolved` znaczy
      // tylko, że sesja jeszcze się nie ustaliła.
      if (err instanceof Error && err.message === "tenant_unresolved") {
        toast.error(tm("toast.noTenant"));
        return;
      }
      toastError(err, "save");
    }
  };

  const assignPlanTier = async (plan: AccessPlanRow, nextKey: string | null) => {
    try {
      await savePlanTierM.mutateAsync({
        id: plan.id,
        expectedUpdatedAt: plan.updated_at,
        patch: { tier_key: nextKey },
      });
      toast.success(tm("toast.planMappingSaved"));
    } catch (err) {
      // Wybór z listy jest natychmiastowy, więc „szkicem" jest sam wybór -
      // po wczytaniu aktualnego katalogu admin wybiera ponownie świadomie.
      showSaveError(err, t, () => void plansQ.refetch());
    }
  };

  return (
    <div className="space-y-6 p-6 font-sans">
      {/* Header + KPI: szybki podgląd stanu katalogu warstw. */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
              <Crown className="h-6 w-6" aria-hidden="true" />
              {tm("title")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tm("subtitle")}</p>
          </div>
          <NewTierDialog
            existingKeys={tiers.map((tt) => tt.key)}
            suggestedRank={(tiers.at(-1)?.rank ?? 0) + 10}
            onCreate={(v) => void createTier(v)}
            isPending={createTierM.isPending}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile
            icon={Layers}
            label={tm("kpi.tiers")}
            value={`${activeTiersCount} / ${tiers.length}`}
          />
          <KpiTile
            icon={ShieldCheck}
            label={tm("kpi.default")}
            value={defaultTier ? (lang === "pl" ? defaultTier.name_pl : defaultTier.name_en) : "-"}
          />
          <KpiTile
            icon={Tag}
            label={tm("kpi.mappedPlans")}
            value={`${mappedPlansCount} / ${plans.length}`}
          />
          <KpiTile icon={Gift} label={tm("kpi.activeGrants")} value={String(activeGrantsCount)} />
        </div>
      </header>

      {/* Tabs porządkują 4 obszary: katalog warstw | mapowanie planów | nadania | organizacje. */}
      <Tabs value={activeTab} onValueChange={selectTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 gap-2 rounded-[6px] border border-border/60 bg-muted/50 p-1.5 shadow-sm sm:inline-flex sm:h-11 sm:w-auto sm:grid-cols-none sm:gap-1">
          <TabsTrigger value="tiers" className={TAB_TRIGGER}>
            <Layers className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.tiers")}</span>
            <span className="ml-0.5 rounded-[4px] bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums">
              {tiers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="mapping" className={TAB_TRIGGER}>
            <Tag className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.mapping")}</span>
          </TabsTrigger>
          <TabsTrigger value="grants" className={TAB_TRIGGER}>
            <Gift className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.grants")}</span>
            <span className="ml-0.5 rounded-[4px] bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums">
              {activeGrantsCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="orgs" className={TAB_TRIGGER}>
            <Landmark className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{tm("tabs.orgs")}</span>
          </TabsTrigger>
        </TabsList>

        {/* ————— WARSTWY ————— */}
        <TabsContent value="tiers" className="mt-4 space-y-4">
          <SectionCard
            icon={Layers}
            title={tm("sections.tiersTitle")}
            description={tm("sections.tiersDesc")}
            padded={false}
          >
            {/* Kompaktowa siatka kafli - pełna edycja w oknie, bez przewijania. */}
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {tiers.map((tier) => {
                const draft = edits[tier.id]?.draft ?? coreDraftFromTier(tier);
                const summary = summarizeCapabilities(draft.features);
                return (
                  <TierSummaryCard
                    key={tier.id}
                    tier={tier}
                    name={lang === "pl" ? tier.name_pl : tier.name_en}
                    description={(lang === "pl" ? tier.description_pl : tier.description_en) || ""}
                    benefitsCount={parseTierBenefits(tier.benefits).length}
                    enabledCount={summary.enabled}
                    enforcedCount={summary.enforced}
                    onOpen={() => openTier(tier.key)}
                  />
                );
              })}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ————— MAPOWANIE PLANÓW ————— */}
        <TabsContent value="mapping" className="mt-4 space-y-4">
          <SectionCard icon={Tag} title={tm("mapping.heading")} description={tm("mapping.hint")}>
            <PlanTierMappingList
              plans={plans}
              tierOptions={tierOptions}
              lang={lang}
              saving={savePlanTierM.isPending}
              onAssign={(planId, key) => {
                const plan = plans.find((p) => p.id === planId);
                if (plan) void assignPlanTier(plan, key);
              }}
            />
          </SectionCard>
        </TabsContent>

        {/* ————— NADANIA ————— */}
        <TabsContent value="grants" className="mt-4 space-y-4">
          <GrantsSection lang={lang} tierOptions={tierOptions} />
        </TabsContent>

        {/* ————— ORGANIZACJE + CONFLUENCE ————— */}
        <TabsContent value="orgs" className="mt-4 space-y-4">
          <SectionCard icon={Landmark} title={tm("org.heading")} description={tm("org.hint")}>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/organizations">
                <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tm("org.open")}
              </Link>
            </Button>
          </SectionCard>
          {/* Referencja tylko dla zespołu: uzgodnienie z modelem Confluence. */}
          <ConfluenceReconciliationCard lang={lang} />
        </TabsContent>
      </Tabs>

      <TierEditorDialog
        tierKey={editingKey}
        tier={editing?.base ?? null}
        draft={editing?.draft ?? null}
        loading={tiersQ.isPending}
        saving={saveTierM.isPending}
        deleting={deleteTierM.isPending}
        canSave={editIsDirty(editing)}
        onOpenChange={(next) => {
          if (!next) openTier(null);
        }}
        onChange={(patch) => {
          if (!editing) return;
          const id = editing.base.id;
          setEdits((current) => {
            const prev = current[id] ?? editing;
            return { ...current, [id]: { ...prev, draft: { ...prev.draft, ...patch } } };
          });
        }}
        onSave={() => {
          if (editing) void saveTier(editing);
        }}
        onDelete={() => {
          if (editing) void deleteTier(editing.base);
        }}
      />
    </div>
  );
}
