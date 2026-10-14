// Molekuła: wycofanie SMS-ów i e-maili o JEDNYM zgłoszeniu po kluczu z maila,
// gdy zgłoszenie jest zamknięte albo wydarzenie się skończyło (przegląd R67,
// REG-10 / REG-17).
//
// DLACZEGO OSOBNA KARTA. Karta przypomnień (`ReminderPreferencesCard`) znika
// przy zgłoszeniu zamkniętym, a po końcu wydarzenia klucz nie otwiera już
// podglądu - gość bez konta, który wyraził zgodę na SMS-y kluczem, tracił
// jedyną drogę do jej wycofania, choć SMS o zwrocie po rezygnacji nadal
// wychodził, a tekst zgody obiecuje: „Zgodę wycofasz, wyłączając SMS".
//
// TYLKO WYŁĄCZANIE. Baza (`event_registration_set_channels`) przyjmuje na
// takim kluczu wyłącznie żądanie, w którym każdy przełącznik jest `false`
// i nie ma zgody - dlatego karta nie ma przełączników, tylko dwa przyciski:
// „Wyłącz SMS-y" (`notify_sms` i `remind_sms`) oraz „Wyłącz e-maile"
// (`notify_email` - główny przełącznik, przypomnienia go czytają).
//
// STAN. Przy zgłoszeniu zamkniętym (klucz jeszcze ważny) wołający podaje
// identyfikator zgłoszenia, a karta czyta preferencje (`event_registration_
// preferences`, cel klucza 'view' działa po zamknięciu) i od razu mówi, co
// jest już wyłączone. Po końcu wydarzenia podglądu nie ma - karta zna stan
// dopiero z odpowiedzi na wyłączenie (wyłączenie jest idempotentne).
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  channelErrorKey,
  setRegistrationChannels,
  type ChannelPrefs,
} from "@/lib/events/registrationChannelsApi";
import {
  registrationPreferencesKey,
  useRegistrationPreferences,
} from "@/lib/events/useRegistrationPreferences";
import { ensureI18n } from "@/lib/i18n-participant-tickets";

ensureI18n();

interface ChannelState {
  smsOn: boolean;
  emailOn: boolean;
}

type Withdrawal = "sms" | "email";

/** Ładunek wyłączenia - wyłącznie `false`, inaczej baza odmówi na tym kluczu. */
const PATCH: Record<Withdrawal, { notifySms?: false; remindSms?: false; notifyEmail?: false }> = {
  sms: { notifySms: false, remindSms: false },
  email: { notifyEmail: false },
};

function stateOf(
  prefs: Pick<ChannelPrefs, "notifySms" | "remindSms" | "notifyEmail">,
): ChannelState {
  return { smsOn: prefs.notifySms || prefs.remindSms, emailOn: prefs.notifyEmail };
}

export function ChannelWithdrawCard({
  manageToken,
  registrationId = null,
  reason,
}: {
  /** Klucz z maila - jedyna droga gościa bez konta. */
  manageToken: string;
  /** Zgłoszenie zamknięte, klucz ważny: stan z podglądu preferencji. */
  registrationId?: string | null;
  /** `closed` - zgłoszenie zamknięte; `expired` - klucz po końcu wydarzenia. */
  reason: "closed" | "expired";
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useRegistrationPreferences({
    registrationId: registrationId ?? "",
    manageToken,
    enabled: registrationId !== null,
  });
  const [saved, setSaved] = useState<ChannelState | null>(null);
  const titleId = useId();

  const known: ChannelState | null =
    saved ?? (query.data?.kind === "ok" ? stateOf(query.data) : null);

  const withdraw = useMutation({
    mutationFn: (what: Withdrawal) => setRegistrationChannels({ manageToken, ...PATCH[what] }),
    onSuccess: (prefs: ChannelPrefs) => {
      setSaved(stateOf(prefs));
      if (registrationId !== null) {
        void queryClient.invalidateQueries({
          queryKey: registrationPreferencesKey(registrationId),
        });
      }
      toast.success(t("participantTickets.withdraw.saved"));
    },
    onError: (error: unknown) => toast.error(t(channelErrorKey(error))),
  });

  const smsOff = known !== null && !known.smsOn;
  const emailOff = known !== null && !known.emailOn;

  return (
    <section
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BellOff className="h-4 w-4" aria-hidden="true" />
        {t("participantTickets.withdraw.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t(
          reason === "closed"
            ? "participantTickets.withdraw.closedBody"
            : "participantTickets.withdraw.expiredBody",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={withdraw.isPending || smsOff}
          onClick={() => withdraw.mutate("sms")}
        >
          {t("participantTickets.withdraw.smsOff")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={withdraw.isPending || emailOff}
          onClick={() => withdraw.mutate("email")}
        >
          {t("participantTickets.withdraw.emailOff")}
        </Button>
      </div>
      {(smsOff || emailOff) && (
        <ul className="space-y-1 text-xs text-muted-foreground" role="status">
          {smsOff && <li>{t("participantTickets.withdraw.smsDone")}</li>}
          {emailOff && <li>{t("participantTickets.withdraw.emailDone")}</li>}
        </ul>
      )}
    </section>
  );
}
