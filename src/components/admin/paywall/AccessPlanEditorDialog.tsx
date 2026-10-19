// Organizm: edytor JEDNEGO planu dostępu (`access_plans`) w oknie - wspólny
// dla /admin/paywall (`?plan=<id>`) i huba „Przychód i lejek" (S7: macierz
// planów, drabina cen). Kontrakt propsów: PLAN S1 §4.7.
//
// CO NAPRAWIA (DIAGNOZA paywalla, S1 def. 3):
//   * KONIEC ZAPISU PEŁNYM WIERSZEM. Dawny formularz odsyłał cały wiersz
//     (`id`, `tenant_id`, `updated_at`, `tier_key`) - zapis ceny po cichu cofał
//     przypięcie warstwy ustawione w międzyczasie w Członkostwie. Teraz patch
//     zawiera WYŁĄCZNIE kolumny zmienione w tym oknie (różnica szkicu względem
//     wiersza, na którym admin zaczął edycję), a mutator `useSaveAccessPlanPatch`
//     sprawdza je z listą właściciela i zapisuje z tokenem `updated_at`
//     (surowy napis z PostgREST). Cudzy zapis po naszym odczycie = konflikt
//     `40001`, nie cichy lost update.
//   * KONFLIKT NIE KASUJE SZKICU. Toast „zmienione w innym miejscu" ma akcję
//     „Wczytaj aktualne": świeży wiersz staje się nową bazą, a pola zmienione
//     przez admina są nakładane na niego (trójstronnie, per pole) - admin widzi
//     cudzą zmianę i swoją naraz i zapisuje ponownie świadomie.
//   * CENA W JEDNOSTKACH GŁÓWNYCH. Pole w groszach („1900" dla 19 zł) myliło
//     o dwa rzędy wielkości; teraz „19,00" przez `parseMoneyInput` (ten sam
//     parser co ceny biletów), z podglądem kwoty tak, jak zobaczy ją kupujący.
//     Zapis niejednoznaczny („1.299") jest odrzucany, nie zgadywany.
//   * WALUTA I CYKL Z LISTY (`FormSelect`), nie wolny tekst - literówka „PNL"
//     dawała plan, którego kasa nie sprzeda.
//   * „W SPRZEDAŻY" (`for_sale`, cennik v6.2) - dotąd niewidoczne dla admina.
//     Odróżnione od „Aktywny": wyłączenie AKTYWNOŚCI odcina obecnych klientów
//     (webhook mapuje cenę tylko na plan aktywny - PLAN S1 V3), więc przy planie
//     z subskrypcjami wymaga potwierdzenia z liczbą odciętych.
//   * WARSTWA (`tier_key`) TYLKO DO ODCZYTU z odnośnikiem do Członkostwa -
//     właściciel kolumny jest jeden (`syncManifest.ts`).
import { useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Save } from "lucide-react";

import { MoneyInputPreview } from "@/components/admin/events/atoms/MoneyInputPreview";
import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import {
  PLAN_CURRENCIES,
  PLAN_INTERVALS,
  draftFromPlan,
  emptyPlanDraft,
  planColumns,
  planMissingCatalogPair,
  planPatch,
  rebaseDraft,
  type PlanDraft,
  type PlanInterval,
} from "@/components/admin/paywall/accessPlanDraft";
import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { LinkedSourceHeader } from "@/components/admin/settings/LinkedSource";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/lib/appDialogs";
import { moneyDecimalSeparator, parseMoneyInput } from "@/lib/billing/moneyInput";
import {
  adminPlansAllQueryOptions,
  planSubscriptionCountQueryOptions,
  useSaveAccessPlanPatch,
  type AccessPlanRow,
} from "@/lib/billing/planQueries";
import { planName } from "@/lib/billing/types";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";
import { toastError } from "@/lib/toastError";

export function AccessPlanEditorDialog({
  planId,
  open,
  onOpenChange,
  readOnly = false,
}: {
  /** `null` = nowy plan. */
  planId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hub S7 dla redaktora: podgląd, pola i zapis wyłączone z powodem. */
  readOnly?: boolean;
}) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  // Jeden wpis cache z katalogiem (`select` wybiera wiersz) - edytor widzi
  // ten sam stan co lista i szyna, bez osobnego zapytania o jeden plan.
  const planQ = useQuery({
    ...adminPlansAllQueryOptions(),
    enabled: open && planId !== null,
    select: (rows: AccessPlanRow[]) => rows.find((row) => row.id === planId) ?? null,
  });
  const close = () => onOpenChange(false);

  let body: ReactNode;
  if (planId === null) {
    body = <PlanEditorForm key="new" base={null} readOnly={readOnly} onDone={close} />;
  } else if (planQ.isError) {
    body = (
      <p role="alert" className="text-sm text-destructive">
        {t("adminPaywall.plans.readError")}
      </p>
    );
  } else if (planQ.isPending) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {t("common.loading")}
      </p>
    );
  } else if (planQ.data === null) {
    body = (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("adminPaywall.editor.notFound")}
      </p>
    );
  } else {
    body = <PlanEditorForm key={planId} base={planQ.data} readOnly={readOnly} onDone={close} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            {planId === null || !planQ.data
              ? t("adminPaywall.editor.titleNew")
              : t("adminPaywall.editor.titleEdit", { name: planName(planQ.data, lang) })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("adminPaywall.editor.description")}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PlanEditorForm({
  base: initialBase,
  readOnly,
  onDone,
}: {
  /** Wiersz, na którym admin zaczyna edycję; `null` = nowy plan. */
  base: AccessPlanRow | null;
  readOnly: boolean;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const separator = moneyDecimalSeparator(i18n.language);
  const qc = useQueryClient();
  const saveM = useSaveAccessPlanPatch("paywall");
  const id = useId();
  const fid = (name: string) => `${id}-${name}`;
  // Baza edycji żyje w stanie, a nie w propsie: odświeżenie katalogu (szyna,
  // druga karta) NIE może podmienić tokenu pod szkicem - wtedy zapis przeszedłby
  // bez konfliktu i nadpisał cudzą zmianę, której admin nie widział.
  const [base, setBase] = useState<AccessPlanRow | null>(initialBase);
  const [draft, setDraft] = useState<PlanDraft>(() =>
    initialBase ? draftFromPlan(initialBase, separator) : emptyPlanDraft(separator),
  );
  const [priceInvalid, setPriceInvalid] = useState(false);
  const set = (patch: Partial<PlanDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const readOnlyReason = readOnly ? t("adminPaywall.readOnly.hint") : null;

  const currencyOptions = [
    ...new Set<string>([...PLAN_CURRENCIES, draft.currency.toUpperCase()]),
  ].map((code) => ({ value: code, label: code }));
  const intervalOptions = PLAN_INTERVALS.map((value) => ({
    value,
    label: t(`adminPaywall.interval.${value}`),
  }));

  const setActive = async (next: boolean) => {
    // Ostrzegamy tylko przy wyłączaniu planu, który w BAZIE jest aktywny -
    // nowy plan i plan już nieaktywny nie mają kogo odciąć.
    if (next || !base?.active) return set({ active: next });
    let count: number;
    try {
      count = await qc.fetchQuery({ ...planSubscriptionCountQueryOptions(base.id), staleTime: 0 });
    } catch (err) {
      console.error("[paywall] subscription count failed", err);
      toast.error(t("adminPaywall.editor.activeCountError"));
      return;
    }
    if (count > 0) {
      const ok = await confirmDialog({
        title: t("adminPaywall.editor.activeOffTitle"),
        description: t("adminPaywall.editor.activeOffDescription", { count }),
        confirmLabel: t("adminPaywall.editor.activeOffConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    set({ active: false });
  };

  const reload = async () => {
    if (!base) return;
    try {
      const rows = await qc.fetchQuery({ ...adminPlansAllQueryOptions(), staleTime: 0 });
      const fresh = rows.find((row) => row.id === base.id);
      if (!fresh) {
        toast.error(t("adminPaywall.editor.notFound"));
        return;
      }
      setDraft((current) =>
        rebaseDraft(current, draftFromPlan(base, separator), draftFromPlan(fresh, separator)),
      );
      setBase(fresh);
      toast.info(t("adminPaywall.sync.reloaded"));
    } catch (err) {
      toastError(err, "load");
    }
  };

  const save = async () => {
    const columns = planColumns(draft);
    setPriceInvalid(columns === null);
    if (columns === null) return;
    try {
      if (base === null) {
        await saveM.mutateAsync({ id: null, expectedUpdatedAt: null, patch: columns });
        toast.success(t("adminPaywall.editor.created"));
        onDone();
        return;
      }
      const baseColumns = planColumns(draftFromPlan(base, separator));
      const patch = baseColumns ? planPatch(columns, baseColumns) : columns;
      // Nic się nie zmieniło - zapis bez kolumn byłby pustym UPDATE-em,
      // który mutator i tak odrzuca (`empty_patch`).
      if (Object.keys(patch).length === 0) return onDone();
      await saveM.mutateAsync({ id: base.id, expectedUpdatedAt: base.updated_at, patch });
      toast.success(t("adminPaywall.editor.saved"));
      onDone();
    } catch (err) {
      showSaveError(err, t, () => void reload());
    }
  };

  const forSaleHintId = `${id}-for-sale-hint`;
  const priceHintId = `${id}-price-hint`;
  // Ostrzeżenie liczone ze SZKICU (cykl, sprzedaż) i warstwy z bazy: admin
  // widzi, że zmiana cyklu albo wznowienie sprzedaży da plan, którego kasa nie
  // sprzeda (`plan_price_missing`), ZANIM zapisze - nie dopiero w tabeli.
  const missingPair = planMissingCatalogPair({
    for_sale: draft.for_sale,
    interval: draft.interval,
    tier_key: base?.tier_key ?? null,
  });

  return (
    <div className="space-y-5">
      <LinkedSourceHeader
        sourceLabel={t("adminPaywall.editor.tierSource")}
        sourceHref="/admin/membership?tab=mapping"
        sourceValue={base?.tier_key ?? null}
        hint={t("adminPaywall.editor.tierHint")}
      />
      {missingPair && (
        // `note`, nie `status`: to stały opis stanu planu, a nie komunikat
        // ogłaszany przy każdej zmianie pola.
        <p
          role="note"
          className="flex items-start gap-2 rounded-[6px] border border-destructive/40 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t("adminPaywall.plans.noCatalogPair")}</span>
            {" - "}
            {t("adminPaywall.plans.noCatalogPairHint")}
          </span>
        </p>
      )}
      {/* `fieldset disabled` wyłącza naraz każde pole (też przełączniki
          i listy Radiksa - to przyciski) w podglądzie huba. */}
      <fieldset disabled={readOnly} className="space-y-5">
        <FieldGroupRule label={t("adminPaywall.editor.groupNaming")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={fid("name-pl")}>{t("adminPaywall.editor.namePl")}</Label>
              <Input
                id={fid("name-pl")}
                value={draft.name_pl}
                onChange={(e) => set({ name_pl: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={fid("name-en")}>{t("adminPaywall.editor.nameEn")}</Label>
              <Input
                id={fid("name-en")}
                value={draft.name_en}
                onChange={(e) => set({ name_en: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={fid("desc-pl")}>{t("adminPaywall.editor.descPl")}</Label>
              <Textarea
                id={fid("desc-pl")}
                rows={2}
                value={draft.description_pl}
                onChange={(e) => set({ description_pl: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={fid("desc-en")}>{t("adminPaywall.editor.descEn")}</Label>
              <Textarea
                id={fid("desc-en")}
                rows={2}
                value={draft.description_en}
                onChange={(e) => set({ description_en: e.target.value })}
              />
            </div>
          </div>
        </FieldGroupRule>

        <FieldGroupRule label={t("adminPaywall.editor.groupPricing")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={fid("price")}>{t("adminPaywall.editor.price")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={fid("price")}
                  inputMode="decimal"
                  aria-describedby={priceHintId}
                  aria-invalid={priceInvalid || undefined}
                  value={draft.price}
                  onChange={(e) => {
                    set({ price: e.target.value });
                    if (priceInvalid) setPriceInvalid(parseMoneyInput(e.target.value) === null);
                  }}
                />
                <MoneyInputPreview value={draft.price} currency={draft.currency} />
              </div>
              <p
                id={priceHintId}
                role={priceInvalid ? "alert" : undefined}
                className={`mt-1 text-[11px] ${priceInvalid ? "text-destructive" : "text-muted-foreground"}`}
              >
                {priceInvalid
                  ? t("adminPaywall.editor.priceInvalid")
                  : t("adminPaywall.editor.priceHint")}
              </p>
            </div>
            <div>
              <Label htmlFor={fid("currency")}>{t("adminPaywall.editor.currency")}</Label>
              <FormSelect
                id={fid("currency")}
                value={draft.currency.toUpperCase()}
                onValueChange={(currency) => set({ currency })}
                options={currencyOptions}
                disabled={readOnly}
              />
            </div>
            <div>
              <Label htmlFor={fid("interval")}>{t("adminPaywall.editor.interval")}</Label>
              <FormSelect
                id={fid("interval")}
                value={draft.interval}
                onValueChange={(value) => set({ interval: value as PlanInterval })}
                options={intervalOptions}
                disabled={readOnly}
              />
            </div>
            <div>
              <Label htmlFor={fid("trial")}>{t("adminPaywall.editor.trialDays")}</Label>
              <Input
                id={fid("trial")}
                type="number"
                min={0}
                value={draft.trial_days}
                onChange={(e) => set({ trial_days: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        </FieldGroupRule>

        <FieldGroupRule label={t("adminPaywall.editor.groupSale")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <Switch
                id={fid("for-sale")}
                checked={draft.for_sale}
                aria-describedby={forSaleHintId}
                onCheckedChange={(next) => set({ for_sale: next })}
              />
              <Label htmlFor={fid("for-sale")} className="pt-0.5 text-sm">
                {t("adminPaywall.editor.forSale")}
              </Label>
              <HintTooltip
                id={forSaleHintId}
                text={t("adminPaywall.editor.forSaleHint")}
                label={t("adminPaywall.editor.forSaleHelp")}
              />
            </div>
            <div className="flex items-start gap-2">
              <Switch
                id={fid("active")}
                checked={draft.active}
                aria-describedby={fid("active-hint")}
                onCheckedChange={(next) => void setActive(next)}
              />
              <div>
                <Label htmlFor={fid("active")} className="text-sm">
                  {t("adminPaywall.editor.active")}
                </Label>
                <p id={fid("active-hint")} className="text-[11px] text-muted-foreground">
                  {t("adminPaywall.editor.activeHint")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={fid("highlighted")}
                checked={draft.highlighted}
                onCheckedChange={(next) => set({ highlighted: next })}
              />
              <Label htmlFor={fid("highlighted")} className="text-sm">
                {t("adminPaywall.editor.highlighted")}
              </Label>
            </div>
            <div>
              <Label htmlFor={fid("sort")}>{t("adminPaywall.editor.sort")}</Label>
              <Input
                id={fid("sort")}
                type="number"
                className="w-24"
                value={draft.sort_order}
                onChange={(e) => set({ sort_order: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={fid("badge-pl")}>{t("adminPaywall.editor.badgePl")}</Label>
              <Input
                id={fid("badge-pl")}
                value={draft.badge_pl}
                onChange={(e) => set({ badge_pl: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={fid("badge-en")}>{t("adminPaywall.editor.badgeEn")}</Label>
              <Input
                id={fid("badge-en")}
                value={draft.badge_en}
                onChange={(e) => set({ badge_en: e.target.value })}
              />
            </div>
          </div>
        </FieldGroupRule>

        <FieldGroupRule label={t("adminPaywall.editor.groupFeatures")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={fid("features-pl")}>{t("adminPaywall.editor.featuresPl")}</Label>
              <Textarea
                id={fid("features-pl")}
                rows={5}
                value={draft.features_pl}
                onChange={(e) => set({ features_pl: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={fid("features-en")}>{t("adminPaywall.editor.featuresEn")}</Label>
              <Textarea
                id={fid("features-en")}
                rows={5}
                value={draft.features_en}
                onChange={(e) => set({ features_en: e.target.value })}
              />
            </div>
          </div>
        </FieldGroupRule>
      </fieldset>

      <DialogFooter className="gap-2 border-t border-border/60 pt-3">
        <Button variant="outline" onClick={onDone}>
          {t("adminPaywall.editor.cancel")}
        </Button>
        <DisabledReason reason={readOnlyReason}>
          <Button onClick={() => void save()} disabled={readOnly || saveM.isPending}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {base === null ? t("adminPaywall.editor.create") : t("adminPaywall.editor.save")}
          </Button>
        </DisabledReason>
      </DialogFooter>
    </div>
  );
}
