// Organizm: "POTRZEBUJE FAKTURY NA FIRME" przy zakupie.
//
// Stoi w kroku platnosci zapisu (`RegistrationPayAction`) PRZED otwarciem
// kasy i w zakupie pakietu (`EventPackagesPurchase`). Caly stan i zapis sa
// w `useInvoiceRequestController` - organizm tylko rysuje przelacznik, pola
// nabywcy i to, co kupujacy musi wiedziec: ze dane juz sa zapisane, ze
// faktura juz jest wystawiona, albo ze trzeba cos poprawic.
//
// BEZ `ssr`: oba ekrany sa `ssr: false` (sesja i swieza dostepnosc), wiec
// organizm nie ma ryzyka hydratacji.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { InvoiceBuyerFields } from "@/components/events/invoices/molecules/InvoiceBuyerFields";
import { hasBuyerErrors } from "@/lib/events/eventInvoiceBuyerDraft";
import type { InvoiceRequestController } from "@/lib/events/useInvoiceRequestController";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

export function InvoiceRequestBlock({ controller }: { controller: InvoiceRequestController }) {
  ensureEventInvoicesI18n();
  const { t } = useTranslation();
  const toggleId = useId();

  if (controller.invoicedNumber !== null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("eventInvoices.request.invoiced", { number: controller.invoicedNumber })}
      </p>
    );
  }

  const profile = controller.profile;
  return (
    <section className="space-y-3 rounded-[6px] border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <input
          id={toggleId}
          type="checkbox"
          className="mt-1"
          checked={controller.wanted}
          aria-describedby={`${toggleId}-hint`}
          onChange={(event) => controller.setWanted(event.target.checked)}
        />
        <div>
          <label htmlFor={toggleId} className="text-sm font-medium">
            {t("eventInvoices.request.toggle")}
          </label>
          <p id={`${toggleId}-hint`} className="text-xs text-muted-foreground">
            {t("eventInvoices.request.toggleHint")}
          </p>
        </div>
      </div>
      {controller.wanted ? (
        <div className="space-y-3">
          {controller.hasExistingRequest ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("eventInvoices.request.existing")}
            </p>
          ) : null}
          {profile === null ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => controller.prefillFromProfile(profile)}
            >
              {t("eventInvoices.request.prefill")}
            </Button>
          )}
          <InvoiceBuyerFields
            value={controller.buyer}
            onChange={controller.setBuyer}
            errors={controller.errors}
            showErrors={controller.showErrors}
            disabled={controller.saving}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={controller.remember}
              onChange={(event) => controller.setRemember(event.target.checked)}
            />
            {t("eventInvoices.request.remember")}
          </label>
          {controller.saving ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("eventInvoices.request.saving")}
            </p>
          ) : null}
          {controller.showErrors && hasBuyerErrors(controller.errors) ? (
            <p role="alert" className="text-sm text-destructive">
              {t("eventInvoices.request.fixErrors")}
            </p>
          ) : null}
          {controller.failureKey === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {t(controller.failureKey)}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
