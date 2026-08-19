// Wejście do portalu klienta operatora płatności (Stripe Customer Portal).
// Jedno miejsce prawdy dla wszystkich ekranów profilu: sesja portalu jest
// tworzona po stronie serwera na podstawie zweryfikowanej sesji użytkownika,
// a powrót wraca na ekran, z którego użytkownik kliknął.
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { providerErrorCode, unwrapProviderResult } from "@/lib/billing/providerResult";
import { safeReturnPath } from "@/lib/billing/returnPath";
import { createStripePortalSession } from "@/utils/payments.functions";

type ButtonProps = React.ComponentProps<typeof Button>;

interface CustomerPortalButtonProps {
  /** Ścieżka powrotu z portalu; domyślnie bieżący adres. */
  returnPath?: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
}

export function CustomerPortalButton({
  returnPath,
  label,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: CustomerPortalButtonProps) {
  const { t } = useTranslation();
  const environment = getStripeEnvironmentSafe();

  const portal = useMutation({
    mutationFn: async () => {
      const current =
        returnPath ??
        (typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : undefined);
      // Ta sama reguła kontraktu, co w `SubscriptionCard` - odmowa operatora
      // („{ error }" bez rzucania) staje się wyjątkiem, więc `onSuccess` znaczy
      // naprawdę sukces. Wcześniej sprawdzenie było skopiowane w obu miejscach.
      return createStripePortalSession({
        data: { environment, returnPath: safeReturnPath(current) },
      }).then(unwrapProviderResult);
    },
    onSuccess: (session) => {
      const url = "url" in session ? session.url : null;
      if (!url) {
        toast.error(t("profile.subscription.portal.error"));
        return;
      }
      // Portal operatora nie działa w iframe - zawsze nowa karta.
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error) =>
      toast.error(
        providerErrorCode(error) === "no_customer"
          ? t("profile.subscription.portal.noCustomer")
          : t("profile.subscription.portal.error"),
      ),
  });

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || portal.isPending}
      onClick={() => portal.mutate()}
    >
      {portal.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
      )}
      {portal.isPending
        ? t("profile.subscription.portal.opening")
        : (label ?? t("profile.subscription.portal.manage"))}
    </Button>
  );
}
