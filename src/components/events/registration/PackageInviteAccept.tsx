// Organizm: delegat domyka zaproszenie na miejsce z pakietu firmowego.
//
// OSTATNI KROK LANCUCHA DELEGOWANIA. Organizator kupuje pakiet, przypisuje
// miejsce i wysyla odnosnik - bez tego ekranu delegat nie ma zadnej
// powierzchni, na ktorej moglby ten odnosnik zamienic na zgloszenie.
//
// WEJSCIE NICZEGO NIE ZMIENIA. Skanery bezpieczenstwa w klientach pocztowych
// odwiedzaja kazdy adres z wiadomosci; gdyby samo otwarcie przyjmowalo
// zaproszenie, miejsce zostaloby zajete przed przeczytaniem maila. Dlatego
// przyjecie wymaga swiadomego wyslania formularza - ten sam wzorzec, co
// strona rezygnacji ze zgloszenia. Otwarcie robi tylko PODGLAD (REG-15):
// stan zaproszenia, wydarzenie i zamaskowany adres.
//
// FORMULARZ WYDARZENIA, NIE WLASNY. Pola obowiazkowe, zgody organizatora
// i regulaminy przychodza z `event_registration_form(slug)` - tego samego,
// ktory rysuje zwykly zapis - a walidacja przechodzi przez wspolny
// `validateRegistrationDraft` (te same sufity pol co baza). Baza i tak sprawdza
// wszystko jeszcze raz (`missing_required_fields`, `terms_required`).
//
// KONTO WIAZE SIE TYLKO Z POTWIERDZONYM ADRESEM ZAPROSZENIA. Notka nad
// formularzem mowi zawczasu, czy zgloszenie trafi do „Moich zgloszen";
// marketing pytamy wylacznie wtedy, gdy baza moze go zapisac (zweryfikowany
// wlasciciel adresu - ta sciezka nie ma maila double opt-in).
//
// STANY ODMOWY MOWIA JEZYKIEM DELEGATA. Mapa odmow zaproszenia
// (`packageInviteErrorMessage`) zamienia kody bazy na zdania, po ktorych
// wiadomo, czy prosic o nowy odnosnik, czy nie robic nic.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, Info, Loader2, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/field-box";
import { CharacterCounter } from "@/components/forms/CharacterCounter";
import { RegistrationAnswerField } from "@/components/events/registration/RegistrationAnswerField";
import { RegistrationTermsList } from "@/components/events/registration/RegistrationTermsList";
import { useAuth } from "@/hooks/useAuth";
import { uiLang } from "@/lib/i18n/format";
import {
  acceptPackageInvite,
  fetchPackageInvitePreview,
  isPackageInviteToken,
  type PackageInviteAcceptResult,
  type PackageInvitePreview,
  type PackageInviteState,
} from "@/lib/events/packageInviteApi";
import { fetchRegistrationForm } from "@/lib/events/publicRegistrationApi";
import { packageInviteErrorMessage } from "@/lib/events/publicRegistrationErrors";
import { REGISTRATION_FIELD_LIMITS as LIMITS } from "@/lib/events/registrationFieldLimits";
import {
  EMPTY_REGISTRATION_FORM,
  type RegistrationForm,
} from "@/lib/events/registrationFormSurface";
import {
  draftAnswers,
  draftErrorMessageKey,
  emptyRegistrationDraft,
  validateRegistrationDraft,
  type RegistrationDraftError,
} from "@/lib/events/registrationSubmitDraft";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

/**
 * Pola szkicu, ktorych zaproszenie NIE pyta: adres stoi w zaproszeniu,
 * a bilet w pakiecie. Ich bledy z wspolnej walidacji pomijamy.
 */
const NOT_ASKED = new Set<string>([
  "email",
  "phone",
  "socialProfileUrl",
  "ticketTypeId",
  "accessCode",
]);

const STATE_MESSAGE: Record<Exclude<PackageInviteState, "open">, string> = {
  used: "eventRegistration.invite.stateUsed",
  expired: "eventRegistration.invite.stateExpired",
  order_cancelled: "eventRegistration.invite.stateOrderCancelled",
  order_refunded: "eventRegistration.invite.stateOrderRefunded",
  event_cancelled: "eventRegistration.invite.stateEventCancelled",
  event_ended: "eventRegistration.invite.stateEventEnded",
  unavailable: "eventRegistration.invite.stateUnavailable",
};

interface InviteDraft {
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyText: string;
  answers: Record<string, string | string[]>;
  acceptedTermIds: string[];
  consentDataProcessing: boolean;
  consentMarketing: boolean;
}

const EMPTY_DRAFT: InviteDraft = {
  firstName: "",
  lastName: "",
  jobTitle: "",
  companyText: "",
  answers: {},
  acceptedTermIds: [],
  consentDataProcessing: false,
  consentMarketing: false,
};

/** Bledy szkicu zaproszenia - wspolna walidacja zapisu bez pol, o ktore nie pytamy. */
function inviteErrors(draft: InviteDraft, form: RegistrationForm): RegistrationDraftError[] {
  return validateRegistrationDraft(
    {
      ...emptyRegistrationDraft(form),
      firstName: draft.firstName,
      lastName: draft.lastName,
      jobTitle: draft.jobTitle,
      companyText: draft.companyText,
      answers: draft.answers,
      acceptedTermIds: draft.acceptedTermIds,
      consentDataProcessing: draft.consentDataProcessing,
    },
    form,
  ).filter((error) => !NOT_ASKED.has(error.field));
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[6px] border border-border bg-card p-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function BackToEvents() {
  const { t } = useTranslation();
  return (
    <Link to="/events" className="inline-block text-sm text-primary hover:underline">
      {t("eventRegistration.invite.backToEvents")}
    </Link>
  );
}

export function PackageInviteAccept({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const valid = token !== null && isPackageInviteToken(token);

  if (!valid) {
    return (
      <section className="space-y-4" aria-live="polite">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.invite.badTokenTitle")}
        </h1>
        <p className="flex items-start gap-2 rounded-[6px] border border-border bg-card p-4 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("eventRegistration.invite.badTokenBody")}
        </p>
        <BackToEvents />
      </section>
    );
  }

  return <InviteFlow token={token} />;
}

/** Licznik montowan podgladu - wyroznik klucza cache zamiast tokenu. */
let inviteMountSeq = 0;
function nextInviteMount(): number {
  inviteMountSeq += 1;
  return inviteMountSeq;
}

function InviteFlow({ token }: { token: string }) {
  const { t } = useTranslation();

  // TOKEN NIE TRAFIA DO KLUCZA CACHE (to poswiadczenie, nie identyfikator).
  // Klucz niesie NUMER MONTOWANIA: trasa montuje komponent z `key={token}`,
  // ale to za malo - stary obserwator odpina sie w tym samym commicie,
  // w ktorym nowy czyta cache, a `gcTime: 0` zdejmuje wpis dopiero w nastepnym
  // takcie. Przy wspolnym kluczu i `staleTime: Infinity` drugi link dostalby
  // podglad pierwszego (cudze wydarzenie i zamaskowany adres) bez zapytania
  // do bazy. Bez ponowien: kazda proba z blednym tokenem to pudlo liczone
  // w bazie.
  const [mount] = useState(nextInviteMount);
  const preview = useQuery<PackageInvitePreview | null>({
    queryKey: ["package-invite", "preview", mount],
    queryFn: () => fetchPackageInvitePreview(token),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (preview.isPending) {
    return (
      <section className="space-y-4" aria-busy="true">
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("eventRegistration.invite.loading")}
        </p>
      </section>
    );
  }

  if (preview.isError) {
    return (
      <section className="space-y-4" aria-live="polite">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.invite.stateTitle")}
        </h1>
        <p className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {packageInviteErrorMessage(preview.error)}
        </p>
        <BackToEvents />
      </section>
    );
  }

  const data = preview.data;
  if (data !== null && data.state !== "open") {
    return (
      <section className="space-y-4" aria-live="polite">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.invite.stateTitle")}
        </h1>
        <p className="flex items-start gap-2 rounded-[6px] border border-border bg-card p-4 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t(STATE_MESSAGE[data.state])}
        </p>
        <BackToEvents />
      </section>
    );
  }

  // Baza sprzed migracji nie ma podgladu (`null`) - formularz bez pol
  // wydarzenia, jak dotad; baza i tak zatrzyma brakujace odpowiedzi.
  return <InviteForm token={token} preview={data} />;
}

function InviteForm({ token, preview }: { token: string; preview: PackageInvitePreview | null }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { session } = useAuth();
  const signedIn = session !== null;
  const slug = preview?.eventSlug ?? null;

  const registrationForm = useQuery({
    queryKey: ["event-registration-form", slug, null],
    queryFn: () => fetchRegistrationForm(slug ?? ""),
    enabled: slug !== null,
    staleTime: 60_000,
  });
  const form: RegistrationForm = registrationForm.data ?? EMPTY_REGISTRATION_FORM;

  const [draft, setDraft] = useState<InviteDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const patch = (next: Partial<InviteDraft>): void => setDraft((prev) => ({ ...prev, ...next }));

  const errors = useMemo(() => inviteErrors(draft, form), [draft, form]);
  const errorOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of errors) map.set(entry.field, t(draftErrorMessageKey(entry), entry.params));
    return map;
  }, [errors, t]);
  const shown = (field: string): string | null => (touched ? (errorOf.get(field) ?? null) : null);

  // Marketing pytamy tylko wtedy, gdy baza moze go zapisac.
  const askMarketing = preview?.accountMatches === true;

  const accept = useMutation<PackageInviteAcceptResult, unknown, void>({
    mutationFn: () =>
      acceptPackageInvite({
        token,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        jobTitle: draft.jobTitle.trim() === "" ? undefined : draft.jobTitle.trim(),
        companyText: draft.companyText.trim() === "" ? undefined : draft.companyText.trim(),
        answers: draftAnswers({ ...emptyRegistrationDraft(form), answers: draft.answers }, form),
        acceptedTermIds: draft.acceptedTermIds,
        consentDataProcessing: draft.consentDataProcessing,
        consentMarketing: askMarketing && draft.consentMarketing,
        lang,
      }),
  });

  if (accept.isSuccess) {
    const result = accept.data;
    // Pakiet jeszcze nieopłacony: miejsce czeka na płatność firmy - ekran nie
    // może mówić „miejsce jest Twoje, zgłoszenie zatwierdzone".
    const awaiting = result.awaitingPayment;
    return (
      <section className="space-y-4" aria-live="polite">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          {awaiting ? (
            <Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
          )}
          {t(
            awaiting
              ? "eventRegistration.invite.awaitingTitle"
              : "eventRegistration.invite.successTitle",
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            awaiting
              ? "eventRegistration.invite.awaitingBody"
              : "eventRegistration.invite.successBody",
          )}
        </p>

        {signedIn && result.accountLinked === true && (
          <Notice>{t("eventRegistration.invite.accountLinked")}</Notice>
        )}
        {signedIn && result.accountLinked === false && (
          <Notice>{t("eventRegistration.invite.accountNotLinked")}</Notice>
        )}

        {result.qrToken !== null && (
          <div className="space-y-1 rounded-[6px] border border-primary/40 bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Ticket className="h-4 w-4" aria-hidden="true" />
              {t("eventRegistration.invite.qrTitle")}
            </p>
            <code className="block break-all font-mono text-sm text-foreground">
              {result.qrToken}
            </code>
            <p className="text-xs text-muted-foreground">{t("eventRegistration.invite.qrHint")}</p>
          </div>
        )}

        {result.manageToken !== null && (
          <div className="space-y-1 rounded-[6px] border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">
              {t("eventRegistration.result.manageTokenTitle")}
            </p>
            <code className="block break-all font-mono text-sm text-foreground">
              {result.manageToken}
            </code>
            <p className="text-xs text-muted-foreground">
              {t("eventRegistration.result.manageTokenHint")}
            </p>
          </div>
        )}

        <BackToEvents />
      </section>
    );
  }

  const formLoading = slug !== null && registrationForm.isPending;
  // Formularz wydarzenia, ktory nie dojechal, to NIE pusty formularz: pola
  // obowiazkowe i regulaminy sa wtedy nieznane, wiec wysylka szlaby z pustymi
  // odpowiedziami, ktorych baza nie przyjmie, a delegat nie mialby czym ich
  // uzupelnic. Przycisk czeka na ponowienie.
  const formFailed = slug !== null && registrationForm.isError;
  const blocked = errors.length > 0 || accept.isPending || formLoading || formFailed;
  const eventTitle =
    preview === null
      ? null
      : ((lang === "en"
          ? (preview.eventTitleEn ?? preview.eventTitlePl)
          : (preview.eventTitlePl ?? preview.eventTitleEn)) ?? null);

  return (
    <section className="space-y-6" aria-live="polite">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.invite.title")}
        </h1>
        {eventTitle !== null && (
          <p className="text-sm font-medium text-foreground">
            {t("eventRegistration.invite.forEvent", { title: eventTitle })}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("eventRegistration.invite.subtitle")}</p>
        {preview !== null && preview.inviteEmailHint !== null && (
          <p className="text-xs text-muted-foreground">
            {t("eventRegistration.invite.addressedTo", { email: preview.inviteEmailHint })}
          </p>
        )}
      </header>

      {/* Czy zgloszenie trafi do konta - zanim delegat wysle formularz. */}
      {preview !== null &&
        (signedIn ? (
          <Notice>
            {preview.accountMatches
              ? t("eventRegistration.invite.accountMatches")
              : t("eventRegistration.invite.accountOther")}
          </Notice>
        ) : (
          <Notice>{t("eventRegistration.invite.signInHint")}</Notice>
        ))}

      {formFailed && (
        <div className="space-y-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3">
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("eventRegistration.invite.formFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={registrationForm.isFetching}
            onClick={() => void registrationForm.refetch()}
          >
            {t("eventRegistration.invite.retry")}
          </Button>
        </div>
      )}

      {/* `noValidate`: braki pokazuje wspolna walidacja szkicu (te same zdania
          co zapis), a nie dymek przegladarki od atrybutu `required`. */}
      <form
        noValidate
        className="space-y-4 rounded-[6px] border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (blocked) return;
          accept.mutate();
        }}
      >
        {/* SUFITY Z `REGISTRATION_FIELD_LIMITS` - te same liczby co baza
            (`invalid_name`, `invalid_job_title`, `invalid_company`). */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t("eventRegistration.fields.firstName")}
            required
            maxLength={LIMITS.name}
            value={draft.firstName}
            autoComplete="given-name"
            invalid={shown("firstName") !== null}
            onChange={(event) => patch({ firstName: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.lastName")}
            required
            maxLength={LIMITS.name}
            value={draft.lastName}
            autoComplete="family-name"
            invalid={shown("lastName") !== null}
            onChange={(event) => patch({ lastName: event.target.value })}
          />
          <div className="min-w-0">
            <FieldBox
              label={t("eventRegistration.fields.jobTitle")}
              maxLength={LIMITS.jobTitle}
              value={draft.jobTitle}
              autoComplete="organization-title"
              invalid={shown("jobTitle") !== null}
              onChange={(event) => patch({ jobTitle: event.target.value })}
            />
            <CharacterCounter count={draft.jobTitle.length} limit={LIMITS.jobTitle} lang={lang} />
          </div>
          <div className="min-w-0">
            <FieldBox
              label={t("eventRegistration.fields.company")}
              maxLength={LIMITS.companyText}
              value={draft.companyText}
              autoComplete="organization"
              invalid={shown("companyText") !== null}
              onChange={(event) => patch({ companyText: event.target.value })}
            />
            <CharacterCounter
              count={draft.companyText.length}
              limit={LIMITS.companyText}
              lang={lang}
            />
          </div>
        </div>

        {(["firstName", "lastName", "jobTitle", "companyText"] as const).map((field) => {
          const message = shown(field);
          return message === null ? null : (
            <p key={field} className="text-sm text-destructive">
              {message}
            </p>
          );
        })}

        {form.fields.length > 0 && (
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-foreground">
              {t("eventRegistration.invite.fieldsTitle")}
            </legend>
            {form.fields.map((field) => (
              <RegistrationAnswerField
                key={field.id}
                field={field}
                lang={lang}
                value={draft.answers[field.key]}
                error={shown(`answer:${field.key}`)}
                onChange={(value) => patch({ answers: { ...draft.answers, [field.key]: value } })}
              />
            ))}
          </fieldset>
        )}

        {(form.terms.length > 0 || (form.consents ?? []).length > 0) && (
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-foreground">
              {t("eventRegistration.invite.termsTitle")}
            </legend>
            {form.terms.length > 0 && (
              <RegistrationTermsList
                terms={form.terms}
                accepted={draft.acceptedTermIds}
                lang={lang}
                error={shown("terms")}
                onToggle={(termId, next) =>
                  patch({
                    acceptedTermIds: next
                      ? [...draft.acceptedTermIds, termId]
                      : draft.acceptedTermIds.filter((entry) => entry !== termId),
                  })
                }
              />
            )}
            {(form.consents ?? []).map((consent) => (
              <RegistrationAnswerField
                key={consent.id}
                field={consent}
                lang={lang}
                value={draft.answers[consent.key]}
                error={shown(`answer:${consent.key}`)}
                onChange={(value) => patch({ answers: { ...draft.answers, [consent.key]: value } })}
              />
            ))}
          </fieldset>
        )}

        <label className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox
            checked={draft.consentDataProcessing}
            onCheckedChange={(value) => patch({ consentDataProcessing: value === true })}
            aria-label={t("eventRegistration.consents.dataProcessing")}
            aria-required="true"
          />
          {/* Gwiazdka jak w formularzu zapisu: bez tej zgody baza odmawia
              (`consent_required`). */}
          <span>{t("eventRegistration.consents.dataProcessing")} *</span>
        </label>
        {shown("consentDataProcessing") !== null && (
          <p className="text-sm text-destructive">{shown("consentDataProcessing")}</p>
        )}

        {askMarketing && (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <Checkbox
              checked={draft.consentMarketing}
              onCheckedChange={(value) => patch({ consentMarketing: value === true })}
              aria-label={t("eventRegistration.consents.marketing")}
            />
            <span>{t("eventRegistration.consents.marketing")}</span>
          </label>
        )}

        {accept.isError && (
          <p className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {packageInviteErrorMessage(accept.error)}
          </p>
        )}

        <Button type="submit" disabled={blocked}>
          {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {accept.isPending
            ? t("eventRegistration.invite.submitting")
            : t("eventRegistration.invite.submit")}
        </Button>
      </form>
    </section>
  );
}
