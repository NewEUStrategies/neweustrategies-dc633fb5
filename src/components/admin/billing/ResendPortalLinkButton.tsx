// Ponowna wysyłka jednorazowego linku do portalu klienta - obsługa zgłoszeń.
//
// Administrator nigdy nie widzi samego linku (jest jednorazowy i wrażliwy) -
// mail trafia wyłącznie na adres właściciela subskrypcji.
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

export function ResendPortalLinkButton({
  userId,
  environment,
  label,
}: ResendPortalLinkButtonProps) {
  const { i18n } = useTranslation();
  const pl = i18n.language !== "en";
  const send = useServerFn(resendPortalLinkForUser);

  const mutation = useMutation({
    mutationFn: () => send({ data: { userId, environment } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(pl ? `Link wysłany na ${res.email}` : `Link sent to ${res.email}`);
        return;
      }
      const messages: Record<string, [string, string]> = {
        no_customer: [
          "Brak konta płatnika dla tego użytkownika.",
          "This user has no billing customer yet.",
        ],
        portal_failed: [
          "Nie udało się utworzyć linku do portalu.",
          "Could not create the portal link.",
        ],
        no_recipient: ["Brak adresu e-mail użytkownika.", "The user has no email address."],
        send_failed: ["Nie udało się wysłać wiadomości.", "Could not send the message."],
      };
      const pair = messages[res.error] ?? messages.send_failed;
      toast.error(pl ? pair[0] : pair[1]);
    },
    onError: () =>
      toast.error(pl ? "Nie udało się wysłać wiadomości." : "Could not send the message."),
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
