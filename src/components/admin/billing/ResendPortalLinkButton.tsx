// Ponowna wysyłka jednorazowego linku do portalu klienta - obsługa zgłoszeń.
//
// Administrator nigdy nie widzi samego linku (jest jednorazowy i wrażliwy) -
// mail trafia wyłącznie na adres właściciela subskrypcji.
//
// Komunikaty pochodzą ze słownika (`adminBilling.resendPortal`). Do 19.08.2026
// istniały wyłącznie w kodzie tego pliku, jako pary `pl ? "..." : "..."` - poza
// bramką parytetu PL/EN i poza zasięgiem tłumacza.
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { resendPortalLinkForUser } from "@/lib/billing/portalLink.functions";
import { Button } from "@/components/ui/button";

export interface ResendPortalLinkButtonProps {
  userId: string;
  environment: "sandbox" | "live";
  label: string;
}

/**
 * Kod odmowy z serwera na klucz komunikatu. Nieznany kod schodzi na „nie udało
 * się wysłać" - operator ma zobaczyć, że coś nie przeszło, a nie surowy kod.
 */
const ERROR_KEY: Record<string, string> = {
  no_customer: "noCustomer",
  portal_failed: "portalFailed",
  no_recipient: "noRecipient",
  send_failed: "sendFailed",
};

export function ResendPortalLinkButton({
  userId,
  environment,
  label,
}: ResendPortalLinkButtonProps) {
  const { t } = useTranslation();
  const tp = (key: string, opts?: Record<string, unknown>) =>
    t(`adminBilling.resendPortal.${key}`, opts);
  const send = useServerFn(resendPortalLinkForUser);

  const mutation = useMutation({
    mutationFn: () => send({ data: { userId, environment } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(tp("sent", { email: res.email }));
        return;
      }
      toast.error(tp(ERROR_KEY[res.error] ?? "sendFailed"));
    },
    onError: () => toast.error(tp("sendFailed")),
  });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <KeyRound className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

export default ResendPortalLinkButton;
