// Organizm: publiczny formularz zapisu na wydarzenie.
//
// GOSC BEZ KONTA TEZ SIE ZAPISUJE - PRZEZ SERWER (REG-04, decyzja D2). Zapis
// idzie funkcja serwerowa (`submitRegistration` -> `submitEventRegistration`):
// najemce, konto i solony skrot adresu zna tylko serwer, a baza liczy na nich
// kubelki prob. Nie stawiamy tu bramki logowania; zalogowanemu wypelniamy
// wstepnie dane, zeby nie przepisywal tego, co juz o nim wiemy.
//
// WYNIK DOSTAJE SKRZYNKA, NIE EKRAN (decyzja D3). Klucz samoobslugi, status
// i kasa wracaja tylko do ZWERYFIKOWANEGO wlasciciela adresu (potwierdzony
// e-mail konta = adres zgloszenia). Kazdy inny widzi `RegistrationCheckEmail` -
// to samo zdanie dla nowego zgloszenia i dla adresu, ktory juz je ma - a mail
// z potwierdzeniem, biletem i atrybucja kampanii wysyla serwer. Formularz NIE
// wola juz ani potwierdzenia mailowego, ani przypiecia atrybucji: atrybucje
// (po bramce zgody) dokleja do wejscia zapisu.
//
// BILETY UKRYTE (REG-05, decyzja D6). Formularz nie oddaje ich wcale; klucz
// biletu z linku (`?ticket=`) jedzie do `event_registration_form`, a bilety
// odsloniete kodem doklejamy do formularza i wysylamy kod przy zapisie
// (`reveal_code`) - bez niego baza odpowiada na bilet ukryty `not_found`.
//
// STAN ZAMKNIETY MA PRAWDZIWY POWOD. Zamiast jednego "zapisy niedostepne"
// pokazujemy `closedReason` z bazy - inaczej uczestnik nie wie, czy wrocic
// pozniej, czy szukac zapisu w zewnetrznym narzedziu.
//
// BLAD Z BAZY NIE KASUJE FORMULARZA. Odmowe pokazujemy nad przyciskiem, a
// wypelnione pola zostaja - to jedyny sposob, zeby "limit miejsc" albo
// "juz zapisany" nie kosztowalo uczestnika calej pracy.
//
// SZKIC ZYJE W KOMPONENCIE, NIE W CACHE. `manage_token` wraca raz i nie moze
// wpasc do cache zapytan, dlatego wynik zapisu trzymamy w stanie lokalnym.
//
// ODMOWA GOSCI NIE GUBI LISTY. Zgloszenie prowadzacego stoi juz w bazie, gdy
// dopisanie gosci (funkcja serwerowa `registerEventGroupGuests` przez
// `registerGroupGuests`, przeglad R38) odmawia, wiec ekran przechodzi na
// potwierdzenie - ale z lista gosci w `GroupGuestsRetryPanel`, a nie z samym
// komunikatem. Ponowny zapis z formularza konczylby sie `already_registered`.
// Po odmowie `group_too_large` panel czyta limit biletu od nowa - osobnym
// wywolaniem `fetchRegistrationForm`, a nie przez `formQuery`: porazka tego
// odczytu nie moze przelaczyc strony w „zapisy niedostepne".
//
// SESJA ZGASLA, GOSCIE WPISANI - ZATRZYMUJEMY ZAPIS. Bez konta dopisanie
// gosci odmawia (`account_required`), wiec formularz
// wysylal pusta liste gosci i pokazywal sukces samego prowadzacego. Goscie nie
// istnieli w bazie, a kupujacy byl przekonany, ze zapisal cala grupe.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n/useLang";
import {
  cancelRegistration,
  fetchRegistrationForm,
  submitRegistration,
  type RegistrationResult,
  type RegistrationSubmitOutcome,
} from "@/lib/events/publicRegistrationApi";
import {
  cancellationErrorMessage,
  isRefundTermsChanged,
  registrationErrorMessage,
} from "@/lib/events/publicRegistrationErrors";
import type { CancellationEffect } from "@/lib/events/cancellationPreview";
import { cancellationPreviewKey } from "@/lib/events/useCancellationPreview";
import {
  draftAccessCode,
  draftAnswers,
  draftErrorMessageKey,
  draftOptionalText,
  draftRevealCode,
  emailDiffersFromAccount,
  emptyRegistrationDraft,
  validateGroupLeadEmail,
  validateRegistrationDraft,
  withRememberedAccessCode,
  type RegistrationDraft,
  type RegistrationDraftError,
} from "@/lib/events/registrationSubmitDraft";
import { REGISTRATION_FIELD_LIMITS as LIMITS } from "@/lib/events/registrationFieldLimits";
import { recallAccessCodeHint, rememberTicketAccessCode } from "@/lib/events/eventCodeMemory";
import { GroupGuestsEditor } from "@/components/events/registration/GroupGuestsEditor";
import {
  GROUP_SIZE_DEFAULT,
  guestIssues,
  registerGroupGuests,
  ticketGroupMaxSize,
  type GroupGuest,
  type GuestIssue,
} from "@/lib/events/ticketTaxGroup";
import {
  EMPTY_REGISTRATION_FORM,
  hasHiddenTickets,
  withRevealedTickets,
  type TicketReveal,
} from "@/lib/events/registrationFormSurface";
import { sendGroupTicketCodes } from "@/lib/events/groupTicketCodes.functions";
import { GroupGuestsRetryPanel } from "@/components/events/registration/organisms/GroupGuestsRetryPanel";
import { sendEventFunnelStep } from "@/lib/events/eventFunnelBeacon";
import { attributionPayload } from "@/lib/events/registrationAttribution";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/field-box";
import { Skeleton } from "@/components/ui/skeleton";
import { CharacterCounter } from "@/components/forms/CharacterCounter";
import { PaidTicketAccountNotice } from "./molecules/PaidTicketAccountNotice";
import { RegistrationCheckEmail } from "./molecules/RegistrationCheckEmail";
import { RegistrationAnswerField } from "./RegistrationAnswerField";
import { RegistrationConfirmation } from "./RegistrationConfirmation";
import { RegistrationTermsList } from "./RegistrationTermsList";
import { RegistrationTicketPicker } from "./RegistrationTicketPicker";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

/** Goście, których baza nie dopisała - wracają do edycji na ekranie potwierdzenia. */
interface GuestRetry {
  guests: GroupGuest[];
  error: unknown;
  maxSize: number;
  leadEmail: string;
  /** Bilet zgłoszenia - po nim panel czyta aktualny limit grupy. */
  ticketTypeId: string | null;
}

export function PublicRegistrationForm({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { user } = useAuth();

  // KLUCZ BILETU Z LINKU (`?ticket=`). Trasa ma `ssr: false`, więc adres jest
  // znany od pierwszego renderu - formularz pytamy nim od razu, bez drugiego
  // odczytu po hydratacji.
  const [ticketKey] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("ticket"),
  );
  const formQuery = useQuery({
    queryKey: ["event-registration-form", slug, ticketKey],
    queryFn: () => fetchRegistrationForm(slug, ticketKey),
    staleTime: 30_000,
  });
  // Bilety odsłonięte kodem (REG-05) dochodzą do formularza: jedna lista dla
  // wyboru, walidacji szkicu i wysyłki.
  const [reveal, setReveal] = useState<TicketReveal | null>(null);
  const form = useMemo(
    () => withRevealedTickets(formQuery.data ?? EMPTY_REGISTRATION_FORM, reveal?.tickets ?? []),
    [formQuery.data, reveal],
  );

  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [errors, setErrors] = useState<RegistrationDraftError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  // Odpowiedź neutralna (`check_email`): adres wpisany w formularzu i to, czy
  // uczestnik zaznaczył zgody czekające na potwierdzenie mailem.
  const [checkEmail, setCheckEmail] = useState<{
    email: string;
    consentPending: boolean;
    guestsDropped: boolean;
  } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const queryClient = useQueryClient();
  const [guests, setGuests] = useState<GroupGuest[]>([]);
  const [guestErrors, setGuestErrors] = useState<(GuestIssue | null)[]>([]);
  const [guestRetry, setGuestRetry] = useState<GuestRetry | null>(null);
  // Ilu gości baza dopisała - ekran potwierdzenia mówi, kiedy dostaną bilety.
  const [guestsAdded, setGuestsAdded] = useState(0);

  // Szkic powstaje dopiero, gdy znamy bilety - domyslny wybor zalezy od tego,
  // ile pozycji jest naprawde w sprzedazy.
  useEffect(() => {
    if (formQuery.data === undefined) return;
    setDraft((current) => current ?? emptyRegistrationDraft(formQuery.data));
  }, [formQuery.data]);

  // Zalogowanemu uzupelniamy to, co juz mamy w metadanych konta. Nie blokujemy
  // pol: dane kontaktowe do wydarzenia moga byc inne niz w profilu.
  //
  // ZALEZNOSCIA JEST ISTNIENIE SZKICU, NIE JEGO TRESC. Sesje `useAuth`
  // odtwarza z pamieci przegladarki, wiec tozsamosc bywa znana ZANIM wroci
  // `event_registration_form` - efekt zalezny od samego `user` trafialby
  // wtedy na `draft === null`, konczyl sie na `return current` i juz nigdy nie
  // powtarzal, bo tozsamosc sie nie zmienia. Tresc szkicu w zaleznosciach
  // bylaby lekarstwem gorszym od choroby: wyczyszczone przez czlowieka pole
  // e-mail wracaloby z konta.
  const hasDraft = draft !== null;
  useEffect(() => {
    if (user === null || !hasDraft) return;
    setDraft((current) => {
      if (current === null || current.email !== "") return current;
      const meta = user.user_metadata;
      const first = typeof meta?.first_name === "string" ? meta.first_name : "";
      const last = typeof meta?.last_name === "string" ? meta.last_name : "";
      return {
        ...current,
        email: user.email ?? "",
        firstName: current.firstName === "" ? first : current.firstName,
        lastName: current.lastName === "" ? last : current.lastName,
      };
    });
  }, [user, hasDraft]);

  // LEJEK: "rozpoczecie zapisu" liczy sie, gdy OTWARTY formularz naprawde
  // stanal przed uczestnikiem (jest szkic, zapis jeszcze nie przeszedl) - raz
  // na sesje; bramka zgody analytics i deduplikacja siedza w beaconie.
  const formOpenForVisitor = form.isOpen && hasDraft && result === null && checkEmail === null;
  useEffect(() => {
    if (formOpenForVisitor) sendEventFunnelStep("registration_start", { slug });
  }, [formOpenForVisitor, slug]);

  // KOD DOSTĘPU Z PAMIĘCI KARTY. Wejściówka za kodem (`requiresAccessCode`)
  // odmawia zapisu bez niego, a uczestnik z linku zaproszenia (`?code=`) ma go
  // już w pamięci - pole wypełniamy, ale nie blokujemy: czy kod pasuje, wie
  // tylko baza. Zmiana biletu ponawia próbę dla nowej wejściówki.
  const codeEventId = form.event?.id ?? "";
  const gatedTicketId =
    draft !== null &&
    form.tickets.some((ticket) => ticket.id === draft.ticketTypeId && ticket.requiresAccessCode)
      ? draft.ticketTypeId
      : null;
  useEffect(() => {
    if (gatedTicketId === null) return;
    const remembered = recallAccessCodeHint(codeEventId, gatedTicketId);
    setDraft((current) => withRememberedAccessCode(current, remembered));
  }, [codeEventId, gatedTicketId]);

  const errorOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of errors) {
      map.set(entry.field, t(draftErrorMessageKey(entry), entry.params));
    }
    return map;
  }, [errors, t]);

  // Potwierdzenie mailowe zapisu i atrybucję kampanii wysyła SERWER zapisu
  // (`eventRegistration.server.ts`) - przeglądarka niezweryfikowanego
  // wołającego nie ma już klucza samoobsługi, którym robiła to dotąd.
  const sendTicketCodes = useServerFn(sendGroupTicketCodes);
  // Zapis bezpłatny: bilety z kodem QR wychodzą od razu, każdy na adres swojej
  // osoby. Przy zapisie płatnym serwer nic nie wyda - zrobi to webhook po
  // zaksięgowaniu płatności. Mail jest dodatkiem: ŻADNA awaria wysyłki (także
  // synchroniczna) nie może wyglądać jak nieudany zapis. Ta sama droga po
  // zapisie grupy i po ponownym dopisaniu gości z ekranu potwierdzenia.
  const sendGuestTickets = (manageToken: string | null): void => {
    if (manageToken === null) return;
    void Promise.resolve()
      .then(() => sendTicketCodes({ data: { manageToken } }))
      .catch(() => {
        /* brak maila nie unieważnia zapisu grupy - cron ponowi wysyłkę */
      });
  };

  const submit = useMutation({
    mutationFn: async ({
      current,
      groupGuests,
      groupMaxSize,
    }: {
      current: RegistrationDraft;
      groupGuests: GroupGuest[];
      groupMaxSize: number;
    }): Promise<RegistrationSubmitOutcome> => {
      const access = draftAccessCode(current, form);
      const outcome = await submitRegistration({
        eventSlug: slug,
        firstName: current.firstName.trim(),
        lastName: current.lastName.trim(),
        email: current.email.trim(),
        phone: draftOptionalText(current.phone),
        jobTitle: draftOptionalText(current.jobTitle),
        companyText: draftOptionalText(current.companyText),
        socialProfileUrl: draftOptionalText(current.socialProfileUrl),
        ticketTypeId: current.ticketTypeId,
        accessCode: access === null ? undefined : access.code,
        revealCode: draftRevealCode(current, form, reveal),
        answers: draftAnswers(current, form),
        acceptedTermIds: current.acceptedTermIds,
        consentDataProcessing: current.consentDataProcessing,
        consentMarketing: current.consentMarketing,
        consentPartnerSharing: current.consentPartnerSharing,
        lang,
        // Atrybucja kampanii po bramce zgody (bez zgody - `null`); przypina ją
        // serwer kluczem samoobsługi, którego przeglądarka może nie dostać.
        attribution: attributionPayload(),
      });
      // Baza przyjęła zapis z tym kodem - kasa zgłoszenia (ekran potwierdzenia)
      // zapyta `event_ticket_checkout_quote` o TEN SAM kod.
      if (access !== null) {
        rememberTicketAccessCode(access.eventId, access.ticketTypeId, access.code);
      }
      // Odpowiedź neutralna: bez identyfikatora zgłoszenia nie ma do czego
      // dopisać gości ani komu wysłać biletów - wynik zapisu jest w mailu.
      if (outcome.kind === "check_email") return outcome;
      const registered = outcome.result;
      // Goście grupy dochodzą do zgłoszenia prowadzącego; płatność obejmie
      // wszystkie miejsca jednym zamówieniem, a każdy dostanie własny kod QR.
      if (groupGuests.length > 0) {
        try {
          setGuestsAdded(await registerGroupGuests(registered.registrationId, groupGuests));
          sendGuestTickets(registered.manageToken);
        } catch (error) {
          // Zgłoszenie prowadzącego już stoi, więc potwierdzenie i tak się
          // pokaże - ale lista gości jedzie z nim dalej, żeby kupujący mógł ją
          // poprawić i dopisać ponownie, zamiast wpisywać wszystko od nowa.
          setGuestRetry({
            guests: groupGuests,
            error,
            maxSize: groupMaxSize,
            leadEmail: current.email.trim(),
            ticketTypeId: current.ticketTypeId,
          });
        }
      }
      return outcome;
    },
    onSuccess: (outcome, { current, groupGuests }) => {
      if (outcome.kind === "registered") {
        setResult(outcome.result);
        return;
      }
      setCheckEmail({
        email: current.email.trim(),
        consentPending: current.consentMarketing || current.consentPartnerSharing,
        // Goście wymagają zgłoszenia KONTA prowadzącego - przy odpowiedzi
        // neutralnej nie zostały dopisane i uczestnik musi to wiedzieć.
        guestsDropped: groupGuests.length > 0,
      });
    },
    onError: (error: unknown) => setFailure(registrationErrorMessage(error)),
  });

  // REZYGNACJA Z EKRANU PO ZAPISIE. Skutek finansowy, który uczestnik
  // potwierdził (REG-03), jedzie z rezygnacją tylko wtedy, gdy baza go wymaga;
  // zmieniony skutek (np. wpłata przeszła na tym ekranie) odświeża podgląd.
  const cancel = useMutation({
    mutationFn: async ({
      current,
      acknowledgedEffect,
    }: {
      current: RegistrationResult;
      acknowledgedEffect?: CancellationEffect;
    }) =>
      cancelRegistration({
        ...(current.manageToken !== null
          ? { manageToken: current.manageToken }
          : { registrationId: current.registrationId }),
        ...(acknowledgedEffect === undefined ? {} : { acknowledgedEffect }),
      }),
    onSuccess: () => {
      setFailure(null);
      setCancelled(true);
    },
    onError: (error: unknown, { current }) => {
      if (isRefundTermsChanged(error)) {
        void queryClient.invalidateQueries({
          queryKey: cancellationPreviewKey(slug, current.manageToken ?? current.registrationId),
        });
      }
      setFailure(cancellationErrorMessage(error));
    },
  });

  if (formQuery.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (formQuery.isError || form.event === null) {
    return (
      <ClosedNotice
        title={t("eventRegistration.closed.title")}
        message={
          formQuery.isError
            ? registrationErrorMessage(formQuery.error)
            : t("eventRegistration.errors.notFound")
        }
        slug={slug}
      />
    );
  }

  const eventTitle = (lang === "en" ? form.event.titleEn : form.event.titlePl) || form.event.slug;

  if (result !== null) {
    return (
      <div className="space-y-6">
        <Header title={eventTitle} />
        {failure !== null && <FailureNotice message={failure} />}
        {guestRetry !== null && !cancelled && (
          <GroupGuestsRetryPanel
            registrationId={result.registrationId}
            leadEmail={guestRetry.leadEmail}
            maxSize={guestRetry.maxSize}
            loadMaxSize={async () =>
              ticketGroupMaxSize(
                // Bilet prowadzącego bywa ukryty i odsłonięty kodem - nowy
                // formularz go nie oddaje, więc doklejamy odsłonięte wiersze.
                withRevealedTickets(
                  await fetchRegistrationForm(slug, ticketKey),
                  reveal?.tickets ?? [],
                ).tickets,
                guestRetry.ticketTypeId,
              )
            }
            initialGuests={guestRetry.guests}
            initialError={guestRetry.error}
            paymentRequired={result.paymentRequired}
            onAdded={(added) => {
              setGuestsAdded(added);
              sendGuestTickets(result.manageToken);
            }}
          />
        )}
        <RegistrationConfirmation
          result={result}
          slug={slug}
          eventId={form.event.id}
          guestsAdded={guestsAdded}
          cancelled={cancelled}
          cancelling={cancel.isPending}
          onCancel={(acknowledgedEffect) => cancel.mutate({ current: result, acknowledgedEffect })}
          signedIn={user !== null}
          lang={lang}
        />
        <BackLink slug={slug} />
      </div>
    );
  }

  // ODPOWIEDŹ NEUTRALNA: bez klucza, rezygnacji i kasy - wynik jest w mailu.
  if (checkEmail !== null) {
    return (
      <div className="space-y-6">
        <Header title={eventTitle} />
        <RegistrationCheckEmail
          email={checkEmail.email}
          consentPending={checkEmail.consentPending}
        />
        {checkEmail.guestsDropped && (
          <p className="text-sm text-muted-foreground">
            {t("eventRegistration.group.guestsNotAdded")}
          </p>
        )}
        <BackLink slug={slug} />
      </div>
    );
  }

  if (!form.isOpen) {
    return (
      <div className="space-y-6">
        <Header title={eventTitle} />
        <ClosedNotice
          title={t("eventRegistration.closed.title")}
          message={t(`eventRegistration.closed.${form.closedReason ?? "unknown"}`)}
          slug={slug}
        />
      </div>
    );
  }

  if (draft === null) return null;
  const current = draft;
  const patch = (next: Partial<RegistrationDraft>): void => setDraft({ ...current, ...next });

  // PLATNA WEJSCIOWKA WYMAGA KONTA (migracja `20260830090000`).
  //
  // Cena obowiazujaca TERAZ, a nie katalogowa: `effectivePriceCents` liczy baza
  // z fazami cenowymi, wiec bilet w promocji za zero zlotych konta nie wymaga -
  // i nie moze byc pytany o nie tylko dlatego, ze `priceCents` jest wyzsze.
  const selectedTicket =
    current.ticketTypeId === null
      ? null
      : (form.tickets.find((ticket) => ticket.id === current.ticketTypeId) ?? null);
  const paidTicketNeedsAccount =
    user === null && selectedTicket !== null && selectedTicket.effectivePriceCents > 0;
  const accessCodeRequired = selectedTicket !== null && selectedTicket.requiresAccessCode;
  const groupEnabled = selectedTicket !== null && selectedTicket.groupRegistrationEnabled;
  // Limit grupy pochodzi z biletu (ten sam, który egzekwuje baza). Po zmianie
  // biletu na mniejszy nadmiarowi goście nie jadą do zapisu - baza i tak
  // odrzuciłaby całą listę jako `group_too_large`.
  const groupMaxSize = selectedTicket?.groupMaxSize ?? GROUP_SIZE_DEFAULT;
  const groupGuests = groupEnabled && user !== null ? guests.slice(0, groupMaxSize - 1) : [];
  // Goscie wpisani, gdy sesja jeszcze byla - `groupGuests` jest wtedy puste,
  // choc lista w stanie nie. Liczy sie wiersz z czymkolwiek wpisanym: pusty
  // wiersz „Dodaj osobe" nie jest gosciem, ktorego by zgubil zapis.
  const guestsLostWithSession =
    groupEnabled &&
    user === null &&
    guests
      .slice(0, groupMaxSize - 1)
      .some((g) => `${g.firstName}${g.lastName}${g.email}`.trim() !== "");

  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        const leadEmail = validateGroupLeadEmail(current, {
          accountEmail: user?.email ?? null,
          guestCount: groupGuests.length,
        });
        const found = [
          ...validateRegistrationDraft(current, form),
          ...(leadEmail === null ? [] : [leadEmail]),
        ];
        setErrors(found);
        const guestFound = guestIssues(groupGuests, current.email);
        setGuestErrors(guestFound);
        if (found.length > 0 || guestFound.some((issue) => issue !== null)) {
          setFailure(null);
          return;
        }
        if (guestsLostWithSession) {
          setFailure(t("eventRegistration.group.sessionLost"));
          return;
        }
        setFailure(null);
        submit.mutate({ current, groupGuests, groupMaxSize });
      }}
    >
      <Header title={eventTitle} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("eventRegistration.sections.person")}
        </h2>
        {/* SUFITY Z `REGISTRATION_FIELD_LIMITS` - te same liczby co schemat
            serwera i CHECK-i bazy. Licznik stoi przy polach, których długość
            realnie się zbliża do sufitu (stanowisko, firma, profil). */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t("eventRegistration.fields.firstName")}
            required
            maxLength={LIMITS.name}
            value={current.firstName}
            invalid={errorOf.has("firstName")}
            onChange={(event) => patch({ firstName: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.lastName")}
            required
            maxLength={LIMITS.name}
            value={current.lastName}
            invalid={errorOf.has("lastName")}
            onChange={(event) => patch({ lastName: event.target.value })}
          />
          <div className="min-w-0">
            <FieldBox
              label={t("eventRegistration.fields.email")}
              required
              type="email"
              autoComplete="email"
              maxLength={LIMITS.email}
              value={current.email}
              invalid={errorOf.has("email")}
              onChange={(event) => patch({ email: event.target.value })}
            />
            {/* REG-01: konto dowiązuje się WYŁĄCZNIE przez swój potwierdzony
                adres - inny adres to zgłoszenie poza „Moimi zgłoszeniami". */}
            {emailDiffersFromAccount(current.email, user?.email ?? null) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("eventRegistration.form.emailDiffersFromAccount")}
              </p>
            )}
          </div>
          <FieldBox
            label={t("eventRegistration.fields.phone")}
            type="tel"
            autoComplete="tel"
            maxLength={LIMITS.phoneMax}
            value={current.phone}
            invalid={errorOf.has("phone")}
            onChange={(event) => patch({ phone: event.target.value })}
          />
          <div className="min-w-0">
            <FieldBox
              label={t("eventRegistration.fields.jobTitle")}
              maxLength={LIMITS.jobTitle}
              value={current.jobTitle}
              invalid={errorOf.has("jobTitle")}
              onChange={(event) => patch({ jobTitle: event.target.value })}
            />
            <CharacterCounter count={current.jobTitle.length} limit={LIMITS.jobTitle} lang={lang} />
          </div>
          <div className="min-w-0">
            <FieldBox
              label={t("eventRegistration.fields.company")}
              maxLength={LIMITS.companyText}
              value={current.companyText}
              invalid={errorOf.has("companyText")}
              onChange={(event) => patch({ companyText: event.target.value })}
            />
            <CharacterCounter
              count={current.companyText.length}
              limit={LIMITS.companyText}
              lang={lang}
            />
          </div>
          <div className="min-w-0 sm:col-span-2">
            <FieldBox
              label={t("eventRegistration.fields.socialProfile")}
              type="url"
              inputMode="url"
              maxLength={LIMITS.socialProfileUrl}
              value={current.socialProfileUrl}
              invalid={errorOf.has("socialProfileUrl")}
              onChange={(event) => patch({ socialProfileUrl: event.target.value })}
            />
            <CharacterCounter
              count={current.socialProfileUrl.length}
              limit={LIMITS.socialProfileUrl}
              lang={lang}
            />
          </div>
        </div>
        <FieldErrors
          messages={[
            "firstName",
            "lastName",
            "email",
            "phone",
            "jobTitle",
            "companyText",
            "socialProfileUrl",
          ]
            .map((field) => errorOf.get(field))
            .filter((entry): entry is string => entry !== undefined)}
        />
      </section>

      {/* SEKCJA BILETU także przy pustej liście, gdy wydarzenie ma bilety
          UKRYTE (REG-05): pole kodu jest wtedy jedyną drogą do biletu. */}
      {(form.tickets.length > 0 || hasHiddenTickets(form)) && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("eventRegistration.sections.ticket")}
          </h2>
          <RegistrationTicketPicker
            tickets={form.tickets}
            value={current.ticketTypeId}
            lang={lang}
            invalid={errorOf.has("ticketTypeId")}
            eventId={form.event.id}
            hasHiddenTickets={hasHiddenTickets(form)}
            requestedKey={ticketKey}
            onReveal={setReveal}
            onChange={(ticketId) => patch({ ticketTypeId: ticketId })}
          />
          {/* KOD DOSTĘPU WYBRANEJ WEJŚCIÓWKI. Karta biletu mówi, skąd go wziąć
              (podpowiedź organizatora); bez pola kod nie miał jak dojść do
              `event_register`, a zapis kończył się odmową `invalid_access_code`. */}
          {accessCodeRequired && (
            <FieldBox
              label={t("eventRegistration.fields.accessCode")}
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.code}
              className="max-w-md uppercase"
              value={current.accessCode}
              invalid={errorOf.has("accessCode")}
              onChange={(event) => patch({ accessCode: event.target.value.toUpperCase() })}
            />
          )}
          <FieldErrors
            messages={[errorOf.get("ticketTypeId"), errorOf.get("accessCode")].filter(
              (entry): entry is string => entry !== undefined,
            )}
          />
          {paidTicketNeedsAccount && <PaidTicketAccountNotice />}
        </section>
      )}

      {groupEnabled && (
        <GroupGuestsEditor
          guests={groupGuests}
          issues={guestErrors}
          maxSize={groupMaxSize}
          requiresAccount={user === null}
          onChange={(next) => {
            setGuests(next);
            setGuestErrors([]);
          }}
        />
      )}

      {form.fields.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("eventRegistration.sections.questions")}
          </h2>
          {form.fields.map((field) => (
            <RegistrationAnswerField
              key={field.id}
              field={field}
              lang={lang}
              value={current.answers[field.key]}
              error={errorOf.get(`answer:${field.key}`) ?? null}
              onChange={(value) => patch({ answers: { ...current.answers, [field.key]: value } })}
            />
          ))}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("eventRegistration.sections.consents")}
        </h2>

        {form.terms.length > 0 && (
          <RegistrationTermsList
            terms={form.terms}
            accepted={current.acceptedTermIds}
            lang={lang}
            error={errorOf.get("terms") ?? null}
            onToggle={(termId, next) =>
              patch({
                acceptedTermIds: next
                  ? [...current.acceptedTermIds, termId]
                  : current.acceptedTermIds.filter((entry) => entry !== termId),
              })
            }
          />
        )}

        {/* ZGODY ZDEFINIOWANE PRZEZ ORGANIZATORA. Stoja tutaj, a nie posrod pytan
            kwalifikacyjnych - zgoda to nie pytanie o dane, tylko oswiadczenie,
            i uczestnik ma je widziec razem z regulaminami. Do naprawy z tego
            commita ta petla w ogole nie istniala, a `event_register` zgod
            WYMAGAL: wymagana zgoda zamykala zapisy na gluchy zamek. */}
        {(form.consents ?? []).map((consent) => (
          <RegistrationAnswerField
            key={consent.id}
            field={consent}
            lang={lang}
            value={current.answers[consent.key]}
            error={errorOf.get(`answer:${consent.key}`) ?? null}
            onChange={(value) => patch({ answers: { ...current.answers, [consent.key]: value } })}
          />
        ))}

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={current.consentDataProcessing}
            onCheckedChange={(next) => patch({ consentDataProcessing: next === true })}
          />
          <span className="text-foreground">
            {t("eventRegistration.consents.dataProcessing")} *
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={current.consentMarketing}
            onCheckedChange={(next) => patch({ consentMarketing: next === true })}
          />
          <span className="text-foreground">{t("eventRegistration.consents.marketing")}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={current.consentPartnerSharing}
            onCheckedChange={(next) => patch({ consentPartnerSharing: next === true })}
          />
          <span className="text-foreground">{t("eventRegistration.consents.partnerSharing")}</span>
        </label>
        <FieldErrors
          messages={[errorOf.get("consentDataProcessing")].filter(
            (entry): entry is string => entry !== undefined,
          )}
        />
      </section>

      {failure !== null && <FailureNotice message={failure} />}
      {/* DRUGA DROGA Z ZABLOKOWANEGO ZAPISU. Bez konta lista gosci stoi ukryta
          pod prosba o logowanie, wiec wpisanych osob nie da sie usunac recznie,
          a logowanie opuszcza strone. Ten przycisk czysci liste - kolejne
          „Zapisz sie" zapisze samego prowadzacego, swiadomie. */}
      {failure !== null && guestsLostWithSession && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setGuests([]);
            setGuestErrors([]);
            setFailure(null);
          }}
        >
          {t("eventRegistration.group.removeLostGuests")}
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submit.isPending || paidTicketNeedsAccount}>
          {submit.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {submit.isPending
            ? t("eventRegistration.actions.submitting")
            : t("eventRegistration.actions.submit")}
        </Button>
        <BackLink slug={slug} />
      </div>
    </form>
  );
}

function Header({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold text-foreground">{t("eventRegistration.heading")}</h1>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{t("eventRegistration.subheading")}</p>
    </header>
  );
}

function BackLink({ slug }: { slug: string }) {
  const { t } = useTranslation();
  return (
    <Button asChild variant="ghost">
      <Link to="/events/$slug" params={{ slug }}>
        {t("eventRegistration.actions.back")}
      </Link>
    </Button>
  );
}

function FailureNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      {message}
    </p>
  );
}

function FieldErrors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-destructive">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function ClosedNotice({ title, message, slug }: { title: string; message: string; slug: string }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <BackLink slug={slug} />
    </section>
  );
}
