// Organizm: ponowne dopisanie gości do zgłoszenia, które JUŻ stoi w bazie.
//
// PO CO TO ISTNIEJE. Zapis grupowy to dwa wywołania: `event_register` zakłada
// zgłoszenie prowadzącego, a `event_register_group_guests` dopisuje do niego
// gości. Gdy drugie odmówi, pierwsze jest już faktem - formularz przechodził
// wtedy na ekran potwierdzenia, a lista gości znikała razem z formularzem.
// Powrót do formularza nic nie dawał, bo ponowny zapis kończy się
// `already_registered` na prowadzącym, więc kupujący tracił drogę do
// dopisania (i opłacenia) osób, po które przyszedł.
//
// LISTA WRACA DO RĘKI. Panel dostaje gości wpisanych w formularzu, pozwala ich
// poprawić w tym samym limicie biletu i dopisuje ich tym samym RPC do TEGO
// SAMEGO zgłoszenia. RPC jest atomowe - odmowa cofa całą listę - więc
// ponowienie nie dubluje osób dopisanych „w połowie".
//
// ZGŁOSZENIE PROWADZĄCEGO NIE ZALEŻY OD GOŚCI. Panel stoi obok potwierdzenia,
// a nie zamiast niego: odmowa dopisania gości nie cofa zapisu kupującego.
//
// KWOTY NIE ODŚWIEŻAMY, BO PO STRONIE KLIENTA NIE MA CZEGO. Liczbę opłacanych
// miejsc liczy `event_registration_group_seats` w funkcji kasy
// (`createCheckoutOrder`) w chwili kliknięcia „Zapłać", po `registration_id`
// prowadzącego - po udanym dopisaniu ten sam przycisk obejmie już wszystkie
// miejsca. Żadne zapytanie ekranu potwierdzenia nie trzyma tej liczby w cache.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GroupGuestsEditor } from "@/components/events/registration/GroupGuestsEditor";
import {
  groupGuestsFailure,
  type RegistrationFailure,
} from "@/lib/events/publicRegistrationErrors";
import {
  guestIssues,
  registerGroupGuests,
  type GroupGuest,
  type GuestIssue,
} from "@/lib/events/ticketTaxGroup";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export interface GroupGuestsRetryPanelProps {
  /** Zgłoszenie prowadzącego - do niego dopisujemy gości. */
  registrationId: string;
  /** Adres prowadzącego - blokuje wpisanie samego siebie jako gościa. */
  leadEmail: string;
  /** Limit grupy biletu (prowadzący + goście), ten sam, co w formularzu. */
  maxSize: number;
  /** Goście wpisani w formularzu - odmowa bazy ich nie kasuje. */
  initialGuests: readonly GroupGuest[];
  /** Pierwsza odmowa `event_register_group_guests` (surowy błąd). */
  initialError: unknown;
  /** Zgłoszenie czeka na zapłatę - gości trzeba dopisać przed kasą. */
  paymentRequired: boolean;
  /** Po udanym dopisaniu - liczba osób, które dopisała baza. */
  onAdded: (added: number) => void;
}

export function GroupGuestsRetryPanel({
  registrationId,
  leadEmail,
  maxSize,
  initialGuests,
  initialError,
  paymentRequired,
  onAdded,
}: GroupGuestsRetryPanelProps) {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<GroupGuest[]>(() => [...initialGuests]);
  const [issues, setIssues] = useState<(GuestIssue | null)[]>([]);
  const [failure, setFailure] = useState<RegistrationFailure | null>(() =>
    groupGuestsFailure(initialError, { maxSize }),
  );
  const [added, setAdded] = useState<number | null>(null);

  const retry = useMutation({
    mutationFn: (next: GroupGuest[]) => registerGroupGuests(registrationId, next),
    onSuccess: (count) => {
      setFailure(null);
      setAdded(count);
      onAdded(count);
    },
    onError: (error: unknown) => setFailure(groupGuestsFailure(error, { maxSize })),
  });

  if (added !== null) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-[6px] border border-primary/40 bg-primary/5 p-3 text-sm text-foreground"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t("eventRegistration.group.retry.added", { count: added })}
      </p>
    );
  }

  function submit(): void {
    // Ta sama walidacja, co w formularzu: baza odrzuciłaby całą listę za
    // jednego gościa bez nazwiska, a tu możemy wskazać, którego.
    const found = guestIssues(guests, leadEmail);
    setIssues(found);
    if (found.some((issue) => issue !== null)) return;
    retry.mutate(guests);
  }

  return (
    <div className="space-y-4 rounded-[6px] border border-destructive/40 p-4">
      {failure !== null && (
        <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {t(failure.key, failure.params)}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("eventRegistration.group.retry.hint")}</p>
      {paymentRequired && (
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.group.retry.beforePayment")}
        </p>
      )}
      <GroupGuestsEditor
        guests={guests}
        issues={issues}
        maxSize={maxSize}
        requiresAccount={false}
        disabled={retry.isPending}
        onChange={(next) => {
          setGuests(next);
          setIssues([]);
        }}
      />
      <Button type="button" disabled={retry.isPending || guests.length === 0} onClick={submit}>
        {retry.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {retry.isPending
          ? t("eventRegistration.group.retry.submitting")
          : t("eventRegistration.group.retry.submit")}
      </Button>
    </div>
  );
}
