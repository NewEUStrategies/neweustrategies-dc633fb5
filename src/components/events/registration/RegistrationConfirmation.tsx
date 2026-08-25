// Molekula: ekran PO zapisie - status, klucz zarzadzania, rezygnacja.
//
// KLUCZ POKAZUJEMY RAZ I TYLKO TUTAJ. Baza trzyma wylacznie SHA-256 z
// `manage_token`, wiec ten napis nie da sie odzyskac - ani przez nas, ani przez
// uczestnika. Dlatego stoi w ramce, ma przycisk kopiowania i zdanie, ze
// pokazujemy go jeden raz. NIE trafia do cache zapytan (mutacja oddaje go
// wywolujacemu), wiec odswiezenie strony go traci - i tak ma byc.
//
// REZYGNACJA DZIALA BEZ KONTA. `event_registration_cancel()` przyjmuje albo
// identyfikator zapisu zalogowanego wlasciciela, albo ten klucz - dlatego gosc
// tez ma tu dzialajacy przycisk, a nie prosbe o kontakt z organizatorem.
//
// ODNOSNIK DO ZARZADZANIA JEST WAZNIEJSZY NIZ SAM KLUCZ. Goly napis do
// przepisania z ekranu ginie razem z zakladka; adres `/events/<slug>/manage`
// z kluczem w zapytaniu da sie zapisac, wyslac sobie mailem i otworzyc na
// telefonie w dniu wydarzenia. Pokazujemy oba, bo klucz bywa wklejany recznie
// w innej przegladarce niz ta, w ktorej powstal zapis.
import { useState } from "react";
import { Check, Copy, Link as LinkIcon, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { RegistrationResult } from "@/lib/events/publicRegistrationApi";
import { manageLinkPath } from "@/lib/events/manageToken";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function RegistrationConfirmation({
  result,
  slug,
  cancelled,
  cancelling,
  onCancel,
}: {
  result: RegistrationResult;
  /** Slug wydarzenia - buduje adres strony zarzadzania zgloszeniem. */
  slug: string;
  /** Zapis odwolany w tej sesji - przycisk rezygnacji nie ma juz sensu. */
  cancelled: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const statusMessage =
    result.status === "waitlist"
      ? result.waitlistPosition === null
        ? t("eventRegistration.result.waitlistNoPosition")
        : t("eventRegistration.result.waitlist", { position: result.waitlistPosition })
      : t(`eventRegistration.result.${result.status}`);

  async function copyToken(): Promise<void> {
    if (result.manageToken === null) return;
    try {
      await navigator.clipboard.writeText(result.manageToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Schowek bywa odcięty uprawnieniami przeglądarki - klucz nadal stoi na
      // ekranie, więc mówimy tylko o nieudanym kopiowaniu.
      toast.error(t("eventRegistration.result.manageTokenTitle"));
    }
  }

  return (
    <section className="space-y-6" aria-live="polite">
      <p className="rounded-[6px] border border-primary/40 bg-primary/5 p-4 text-sm text-foreground">
        {cancelled ? t("eventRegistration.result.cancelled") : statusMessage}
      </p>

      {result.manageToken !== null && !cancelled && (
        <div className="space-y-3 rounded-[6px] border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t("eventRegistration.result.manageTokenTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("eventRegistration.result.manageTokenHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-[6px] bg-muted px-3 py-2 text-xs text-foreground">
              {result.manageToken}
            </code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyToken()}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {t("eventRegistration.result.manageTokenTitle")}
            </Button>
          </div>

          <div className="border-t border-border pt-3">
            <a
              href={manageLinkPath(slug, result.manageToken)}
              rel="nofollow"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              {t("eventFront.manage.manageLink")}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("eventFront.manage.manageLinkHint")}
            </p>
          </div>
        </div>
      )}

      {!cancelled && (
        <Button type="button" variant="ghost" disabled={cancelling} onClick={onCancel}>
          <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {cancelling
            ? t("eventRegistration.actions.cancelling")
            : t("eventRegistration.actions.cancel")}
        </Button>
      )}
    </section>
  );
}
