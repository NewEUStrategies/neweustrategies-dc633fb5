// Odzyskiwanie faktury po numerze transakcji + mail z linkiem do portalu klienta.
//
// Faktur nie trzymamy u siebie - operator (Merchant of Record) wystawia je i
// udostępnia pod krótkotrwałym adresem. Użytkownik wkleja numer `txn_...` z
// maila, serwer sprawdza własność transakcji i zwraca jednorazowy link.
// Drugi przycisk wysyła na adres konta jednorazowy link do portalu klienta
// (zmiana metody płatności, faktury, anulowanie).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Loader2, Search } from "lucide-react";

import { getStripeEnvironment } from "@/lib/stripe";
import { fetchMyInvoiceByTransaction, sendMyPortalLink } from "@/lib/billing/portalLink.functions";
import { isTransactionId, normalizeTransactionId } from "@/lib/billing/transactionId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";

export function InvoiceLookupCard() {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const findInvoice = useServerFn(fetchMyInvoiceByTransaction);
  const sendPortal = useServerFn(sendMyPortalLink);

  const trimmed = normalizeTransactionId(value);
  const valid = isTransactionId(trimmed);
  const showError = touched && trimmed.length > 0 && !valid;

  const lookup = useMutation({
    mutationFn: () =>
      findInvoice({ data: { transactionId: trimmed, environment: getStripeEnvironment() } }),
    onSuccess: (res) => {
      if (res.ok) {
        setUrl(res.url);
        toast.success(t("profile.orders.invoiceLookup.found"));
        return;
      }
      setUrl(null);
      toast.error(t(`profile.orders.invoiceLookup.errors.${res.error}`));
    },
    onError: () => {
      setUrl(null);
      toast.error(t("profile.orders.invoiceLookup.errors.invoice_unavailable"));
    },
  });

  const portal = useMutation({
    mutationFn: () => sendPortal({ data: { environment: getStripeEnvironment() } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(t("profile.orders.portalEmail.sent", { email: res.email }));
        return;
      }
      toast.error(t(`profile.orders.portalEmail.errors.${res.error}`));
    },
    onError: () => toast.error(t("profile.orders.portalEmail.errors.send_failed")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.orders.invoiceLookup.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.orders.invoiceLookup.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid && !lookup.isPending) lookup.mutate();
          }}
        >
          <FloatingInput
            label={t("profile.orders.invoiceLookup.label")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            spellCheck={false}
            containerClassName="w-full sm:max-w-sm"
            error={showError ? t("profile.orders.invoiceLookup.errors.invalid_transaction") : null}
          />
          <Button type="submit" disabled={!valid || lookup.isPending} className="h-12 shrink-0">
            {lookup.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t("profile.orders.invoiceLookup.cta")}
          </Button>
        </form>

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t("profile.orders.invoiceLookup.download")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}

        <div className="border-t pt-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {t("profile.orders.portalEmail.hint")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-12"
            disabled={portal.isPending}
            onClick={() => portal.mutate()}
          >
            {portal.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t("profile.orders.portalEmail.cta")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default InvoiceLookupCard;
