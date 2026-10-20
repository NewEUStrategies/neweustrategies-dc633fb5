// Organizm: ustawienia kasy - kody promocyjne Stripe, Stripe Tax, NIP na
// fakturze, faktury dla płatności jednorazowych. Serwer czyta te flagi przy
// tworzeniu sesji (`createCheckoutOrder`). Reużywa go hub S7.
//
// CO NAPRAWIA.
//   * ZAPIS Z TOKENEM. Dawny `upsert(onConflict: tenant_id)` nadpisywał
//     ustawienia bez względu na to, co admin widział w drugiej karcie;
//     `useSaveCheckoutSettings` robi UPDATE warunkowany `updated_at`
//     (konflikt `40001`), a przy braku wiersza INSERT.
//   * PULPIT MONETYZACJI ŚWIEŻY (DIAGNOZA #8). Zapis unieważnia też
//     `billingKeys.admin.monetization()` - karta kasy na pulpicie pokazywała
//     stan sprzed zapisu do przeładowania strony.
//   * JEDEN WPIS CACHE z kasą czytelnika (`checkoutSettingsQueryOptions`,
//     klucz z fabryki, który odświeża szyna).
//
// Szkic jest kopią na żądanie: dopóki admin niczego nie ruszył, formularz
// pokazuje stan serwera (także po zapisie z innej karty), a nie zamrożoną
// kopię z chwili montowania.
//
// OKNO PORZUCENIA KASY (I9a, 2026-10-20). `abandon_after_minutes` (kolumna
// I0, czytana przez kasę od S3 - P22) nie miało UI, więc właściciel nie mógł
// skrócić 24 h. Pole trzyma WŁASNY napis szkicu: liczba wpisana z błędem
// (`20`, `90.5`, puste) zostaje na ekranie z komunikatem i blokuje zapis,
// zamiast po cichu zamienić się w najbliższą poprawną wartość (AGENTS:
// odrzucenie, nie przycięcie). Granice i predykat ze wspólnego
// `lib/revenue/limits.ts` - te same, którymi serwer kasy czyta kolumnę i które
// pilnuje CHECK bazy. Zapis idzie tym samym mutatorem z tokenem `updated_at`
// co reszta karty, więc konflikt dwóch kart wygląda tak samo.
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

import { CheckoutPlanePreview } from "@/components/admin/paywall/CheckoutPlanePreview";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { checkoutSettingsQueryOptions, useSaveCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import type { CheckoutSettings } from "@/lib/billing/checkoutSettings";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";
import {
  REVENUE_LIMITS,
  effectiveCheckoutAbandonMinutes,
  parseCheckoutAbandonMinutes,
} from "@/lib/revenue/limits";

/** Granice okna porzucenia do napisów - jeden obiekt dla podpowiedzi i błędu. */
const ABANDON_BOUNDS = {
  min: REVENUE_LIMITS.checkoutAbandonMinutesMin,
  max: REVENUE_LIMITS.checkoutAbandonMinutesMax,
  fallback: REVENUE_LIMITS.checkoutAbandonMinutesDefault,
} as const;

type CheckoutToggleKey =
  "allow_promotion_codes" | "automatic_tax" | "tax_id_collection" | "invoice_creation";

const TOGGLES: readonly { key: CheckoutToggleKey; label: string; hint: string }[] = [
  {
    key: "allow_promotion_codes",
    label: "adminPaywall.checkout.allowPromo",
    hint: "adminPaywall.checkout.allowPromoHint",
  },
  {
    key: "automatic_tax",
    label: "adminPaywall.checkout.automaticTax",
    hint: "adminPaywall.checkout.automaticTaxHint",
  },
  {
    key: "tax_id_collection",
    label: "adminPaywall.checkout.taxIdCollection",
    hint: "adminPaywall.checkout.taxIdCollectionHint",
  },
  {
    key: "invoice_creation",
    label: "adminPaywall.checkout.invoiceCreation",
    hint: "adminPaywall.checkout.invoiceCreationHint",
  },
];

/** Kolumny ustawień bez tokenu - to, co trafia do szkicu i do podglądu sesji. */
function settingsOnly(state: CheckoutSettings & { updated_at?: string | null }): CheckoutSettings {
  return {
    allow_promotion_codes: state.allow_promotion_codes,
    automatic_tax: state.automatic_tax,
    tax_id_collection: state.tax_id_collection,
    billing_address_collection: state.billing_address_collection,
    invoice_creation: state.invoice_creation,
    abandon_after_minutes: state.abandon_after_minutes,
  };
}

/**
 * Okno zapisane na serwerze do pokazania w polu. Wiersz bez poprawnej wartości
 * (brak wiersza najemcy) pokazuje domyślne bazy - to samo, co kasa stosuje.
 */
function savedAbandon(settings: CheckoutSettings): number {
  return effectiveCheckoutAbandonMinutes(settings.abandon_after_minutes);
}

export function CheckoutSettingsCard({ readOnly = false }: { readOnly?: boolean }) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  const settingsQ = useQuery(checkoutSettingsQueryOptions());
  const saveM = useSaveCheckoutSettings();
  const [draft, setDraft] = useState<CheckoutSettings | null>(null);
  // Napis pola okna porzucenia; `null` = admin go nie ruszał (pokaż serwer).
  const [abandonText, setAbandonText] = useState<string | null>(null);
  const saved = settingsQ.data;
  const current = draft ?? (saved ? settingsOnly(saved) : null);
  const readOnlyReason = readOnly ? t("adminPaywall.readOnly.hint") : null;
  const savedMinutes = current ? savedAbandon(current) : null;
  const abandonMinutes =
    abandonText === null ? savedMinutes : parseCheckoutAbandonMinutes(abandonText);
  const abandonInvalid = abandonText !== null && abandonMinutes === null;

  const resetDraft = () => {
    setDraft(null);
    setAbandonText(null);
  };

  const save = async () => {
    if (!current || !saved || abandonMinutes === null) return;
    try {
      await saveM.mutateAsync({
        settings: { ...current, abandon_after_minutes: abandonMinutes },
        expectedUpdatedAt: saved.updated_at,
      });
      resetDraft();
      toast.success(t("adminPaywall.checkout.saved"));
    } catch (err) {
      if (isStaleWriteError(err)) {
        showSaveError(err, t, () => {
          void settingsQ.refetch().then(resetDraft);
        });
        return;
      }
      console.error("[paywall] checkout settings save failed", err);
      toast.error(t("adminPaywall.checkout.saveError"));
    }
  };

  return (
    <SectionCard
      icon={CreditCard}
      title={t("adminPaywall.checkout.title")}
      description={t("adminPaywall.checkout.subtitle")}
    >
      {settingsQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminPaywall.checkout.readError")}
          <Button size="sm" variant="outline" onClick={() => void settingsQ.refetch()}>
            {t("adminPaywall.checkout.retry")}
          </Button>
        </div>
      ) : !current ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : (
        <fieldset disabled={readOnly} className="space-y-4">
          {TOGGLES.map(({ key, label, hint }) => (
            <div key={key}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  id={`${id}-${key}`}
                  checked={current[key]}
                  aria-describedby={`${id}-${key}-hint`}
                  onCheckedChange={(next) => setDraft({ ...current, [key]: next })}
                />
                <Label htmlFor={`${id}-${key}`}>{t(label)}</Label>
              </div>
              <p id={`${id}-${key}-hint`} className="mt-1 pl-10 text-xs text-muted-foreground">
                {t(hint)}
              </p>
            </div>
          ))}
          <div className="w-64">
            <Label htmlFor={`${id}-address`}>{t("adminPaywall.checkout.addressCollection")}</Label>
            <FormSelect
              id={`${id}-address`}
              value={current.billing_address_collection}
              disabled={readOnly}
              onValueChange={(value) =>
                setDraft({
                  ...current,
                  billing_address_collection: value === "required" ? "required" : "auto",
                })
              }
              options={[
                { value: "auto", label: t("adminPaywall.checkout.addressAuto") },
                { value: "required", label: t("adminPaywall.checkout.addressRequired") },
              ]}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-abandon`}>{t("adminPaywall.checkout.abandonAfter")}</Label>
              <HintTooltip
                id={`${id}-abandon-help`}
                text={t("adminPaywall.checkout.abandonAfterTooltip", ABANDON_BOUNDS)}
                label={t("adminPaywall.checkout.abandonAfterHelp")}
              />
            </div>
            <Input
              id={`${id}-abandon`}
              type="number"
              inputMode="numeric"
              min={ABANDON_BOUNDS.min}
              max={ABANDON_BOUNDS.max}
              step={1}
              value={abandonText ?? String(savedMinutes ?? "")}
              aria-invalid={abandonInvalid}
              aria-describedby={
                abandonInvalid
                  ? `${id}-abandon-error ${id}-abandon-hint ${id}-abandon-help`
                  : `${id}-abandon-hint ${id}-abandon-help`
              }
              onChange={(e) => setAbandonText(e.target.value)}
              className="w-40"
            />
            <p id={`${id}-abandon-hint`} className="mt-1 text-xs text-muted-foreground">
              {t("adminPaywall.checkout.abandonAfterHint", ABANDON_BOUNDS)}
            </p>
            {abandonInvalid ? (
              <p id={`${id}-abandon-error`} role="alert" className="mt-1 text-xs text-destructive">
                {t("adminPaywall.checkout.abandonAfterInvalid", ABANDON_BOUNDS)}
              </p>
            ) : null}
          </div>
          {/* Podgląd tego, co NAPRAWDĘ pojedzie do sesji Stripe - liczony tą
              samą czystą funkcją co serwer, więc panel nie może obiecać flagi,
              której API nie dostanie (np. `automatic_tax` w trybie MoR). */}
          <CheckoutPlanePreview settings={current} />
          <DisabledReason reason={readOnlyReason}>
            <Button
              onClick={() => void save()}
              disabled={readOnly || saveM.isPending || abandonInvalid}
            >
              {t("adminPaywall.checkout.save")}
            </Button>
          </DisabledReason>
        </fieldset>
      )}
    </SectionCard>
  );
}
