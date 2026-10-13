// GNIAZDO `ManageConsentsSlot` - samoobsługi zgłoszenia po kluczu - wycofanie
// zgód marketingu i przekazania danych partnerom (REG-14).
//
// WYCOFANIE MUSI BYĆ RÓWNIE ŁATWE JAK UDZIELENIE (art. 7 ust. 3 RODO). Gość
// bez konta ma tylko ten klucz - więc tu, obok rezygnacji, stoją trzy
// przyciski: marketing, partnerzy, obie zgody. Każdy pyta o potwierdzenie
// w oknie dialogowym (jedno kliknięcie nie powinno niczego zmieniać).
//
// ODPOWIEDŹ NEUTRALNA. Baza odpowiada tym samym `{ok:true}` bez względu na to,
// czy zgoda była aktywna - klucz samoobsługi trafia czasem w cudze ręce
// (przekazany mail), a strona nie może zdradzać stanu cudzych zgód. Dlatego
// po wycofaniu mówimy jedno zdanie: „zapisaliśmy decyzję; jeśli zgoda była
// aktywna, przestała obowiązywać".
//
// KIEDY SIĘ POKAZUJE. Host montuje gniazdo przy każdym kluczu, który nie jest
// nieznany - także po anulowaniu zgłoszenia i po końcu wydarzenia (klucz
// wygasły): zgodę wycofuje się w dowolnej chwili, nie tylko do wydarzenia.
//
// Właściwości: wyłącznie klucz (podzbiór `ManagePanelSlotProps`) - gniazdo nie
// potrzebuje stanu zgłoszenia, którego po wygaśnięciu klucza i tak nie ma.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ManagePanelSlotProps } from "@/components/events/participant/slots/slotTypes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type {
  EventConsentWithdrawResult,
  EventConsentWithdrawScope,
} from "@/lib/events/eventConsent";
import { withdrawEventConsents } from "@/lib/events/eventConsent.functions";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export type ManageConsentsSlotProps = Pick<ManagePanelSlotProps, "token">;

/** Zakres -> (przycisk, zdanie w oknie). Pełne literały kluczy dla bramki słowników. */
const SCOPE_COPY: Record<EventConsentWithdrawScope, { button: string; confirm: string }> = {
  marketing: {
    button: "eventRegistration.manage.consents.withdrawMarketing",
    confirm: "eventRegistration.manage.consents.confirmMarketing",
  },
  partner_sharing: {
    button: "eventRegistration.manage.consents.withdrawPartner",
    confirm: "eventRegistration.manage.consents.confirmPartner",
  },
  all: {
    button: "eventRegistration.manage.consents.withdrawAll",
    confirm: "eventRegistration.manage.consents.confirmAll",
  },
};

const SCOPES: EventConsentWithdrawScope[] = ["marketing", "partner_sharing", "all"];

/** Wynik -> zdanie po wycofaniu. Każde `ok` to TO SAMO zdanie (bez stanu). */
function resultKey(result: EventConsentWithdrawResult): string {
  if (result.ok) return "eventRegistration.manage.consents.done";
  if (result.reason === "rate_limited") return "eventRegistration.manage.consents.rateLimited";
  return "eventRegistration.manage.consents.failed";
}

export function ManageConsentsSlot({ token }: ManageConsentsSlotProps) {
  const { t } = useTranslation();
  const withdraw = useServerFn(withdrawEventConsents);
  const [asked, setAsked] = useState<EventConsentWithdrawScope | null>(null);
  const [message, setMessage] = useState<{ key: string; ok: boolean } | null>(null);

  const withdrawM = useMutation({
    mutationFn: (purposes: EventConsentWithdrawScope) =>
      withdraw({ data: { purposes, manageToken: token } }),
    onSuccess: (result) => setMessage({ key: resultKey(result), ok: result.ok }),
    onError: () => setMessage({ key: "eventRegistration.manage.consents.failed", ok: false }),
    onSettled: () => setAsked(null),
  });

  if (token === null) return null;

  return (
    <section
      aria-labelledby="manage-consents-title"
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
    >
      <h2
        id="manage-consents-title"
        className="flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <ShieldOff className="h-4 w-4" aria-hidden="true" />
        {t("eventRegistration.manage.consents.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("eventRegistration.manage.consents.body")}</p>
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((scope) => (
          <Button
            key={scope}
            type="button"
            variant="outline"
            size="sm"
            disabled={withdrawM.isPending}
            onClick={() => {
              setMessage(null);
              setAsked(scope);
            }}
          >
            {t(SCOPE_COPY[scope].button)}
          </Button>
        ))}
      </div>
      {message !== null && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}
        >
          {t(message.key)}
        </p>
      )}

      <AlertDialog
        open={asked !== null}
        onOpenChange={(open) => {
          if (!open && !withdrawM.isPending) setAsked(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("eventRegistration.manage.consents.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {asked === null ? "" : t(SCOPE_COPY[asked].confirm)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={withdrawM.isPending}>
              {t("eventRegistration.manage.consents.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={withdrawM.isPending}
              onClick={(event) => {
                // Okno zamyka WYNIK, nie klik: do odpowiedzi serwera oba
                // przyciski są zablokowane, a zdanie wyniku staje pod
                // przyciskami gniazda (także przy awarii - wtedy z prośbą
                // o ponowienie).
                event.preventDefault();
                if (asked !== null) withdrawM.mutate(asked);
              }}
            >
              {withdrawM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {withdrawM.isPending
                ? t("eventRegistration.manage.consents.working")
                : t("eventRegistration.manage.consents.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
