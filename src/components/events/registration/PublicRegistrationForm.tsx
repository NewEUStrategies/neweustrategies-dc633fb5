// Organizm: publiczny formularz zapisu na wydarzenie.
//
// GOSC BEZ KONTA TEZ SIE ZAPISUJE. `event_registration_form()`,
// `event_register()` i `event_registration_cancel()` maja GRANT dla `anon`,
// wiec nie stawiamy tu bramki logowania. Zalogowanego uzytkownika baza wiaze z
// kontem sama (`auth.uid()`), a my tylko wypelniamy mu wstepnie dane, zeby nie
// przepisywal tego, co juz o nim wiemy.
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
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
} from "@/lib/events/publicRegistrationApi";
import { registrationErrorMessage } from "@/lib/events/publicRegistrationErrors";
import {
  draftAnswers,
  draftOptionalText,
  emptyRegistrationDraft,
  validateRegistrationDraft,
  type RegistrationDraft,
  type RegistrationDraftError,
} from "@/lib/events/registrationSubmitDraft";
import { EMPTY_REGISTRATION_FORM } from "@/lib/events/registrationFormSurface";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/field-box";
import { Skeleton } from "@/components/ui/skeleton";
import { RegistrationAnswerField } from "./RegistrationAnswerField";
import { RegistrationConfirmation } from "./RegistrationConfirmation";
import { RegistrationTermsList } from "./RegistrationTermsList";
import { RegistrationTicketPicker } from "./RegistrationTicketPicker";

export function PublicRegistrationForm({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { user } = useAuth();

  const formQuery = useQuery({
    queryKey: ["event-registration-form", slug],
    queryFn: () => fetchRegistrationForm(slug),
    staleTime: 30_000,
  });
  const form = formQuery.data ?? EMPTY_REGISTRATION_FORM;

  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [errors, setErrors] = useState<RegistrationDraftError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // Szkic powstaje dopiero, gdy znamy bilety - domyslny wybor zalezy od tego,
  // ile pozycji jest naprawde w sprzedazy.
  useEffect(() => {
    if (formQuery.data === undefined) return;
    setDraft((current) => current ?? emptyRegistrationDraft(formQuery.data));
  }, [formQuery.data]);

  // Zalogowanemu uzupelniamy to, co juz mamy w metadanych konta. Nie blokujemy
  // pol: dane kontaktowe do wydarzenia moga byc inne niz w profilu.
  useEffect(() => {
    if (user === null) return;
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
  }, [user]);

  const errorOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of errors) {
      map.set(entry.field, t(`eventRegistration.validation.${entry.errorKey}`));
    }
    return map;
  }, [errors, t]);

  const submit = useMutation({
    mutationFn: async (current: RegistrationDraft) => {
      return submitRegistration({
        eventSlug: slug,
        firstName: current.firstName.trim(),
        lastName: current.lastName.trim(),
        email: current.email.trim(),
        phone: draftOptionalText(current.phone),
        jobTitle: draftOptionalText(current.jobTitle),
        companyText: draftOptionalText(current.companyText),
        socialProfileUrl: draftOptionalText(current.socialProfileUrl),
        ticketTypeId: current.ticketTypeId,
        answers: draftAnswers(current, form),
        acceptedTermIds: current.acceptedTermIds,
        consentDataProcessing: current.consentDataProcessing,
        consentMarketing: current.consentMarketing,
        consentPartnerSharing: current.consentPartnerSharing,
      });
    },
    onSuccess: (data) => {
      setFailure(null);
      setResult(data);
    },
    onError: (error: unknown) => setFailure(registrationErrorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: async (current: RegistrationResult) =>
      cancelRegistration(
        current.manageToken !== null
          ? { manageToken: current.manageToken }
          : { registrationId: current.registrationId },
      ),
    onSuccess: () => {
      setFailure(null);
      setCancelled(true);
    },
    onError: (error: unknown) => setFailure(registrationErrorMessage(error)),
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
        <RegistrationConfirmation
          result={result}
          cancelled={cancelled}
          cancelling={cancel.isPending}
          onCancel={() => cancel.mutate(result)}
        />
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

  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validateRegistrationDraft(current, form);
        setErrors(found);
        if (found.length > 0) {
          setFailure(null);
          return;
        }
        submit.mutate(current);
      }}
    >
      <Header title={eventTitle} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("eventRegistration.sections.person")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t("eventRegistration.fields.firstName")}
            required
            value={current.firstName}
            invalid={errorOf.has("firstName")}
            onChange={(event) => patch({ firstName: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.lastName")}
            required
            value={current.lastName}
            invalid={errorOf.has("lastName")}
            onChange={(event) => patch({ lastName: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.email")}
            required
            type="email"
            autoComplete="email"
            value={current.email}
            invalid={errorOf.has("email")}
            onChange={(event) => patch({ email: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.phone")}
            type="tel"
            autoComplete="tel"
            value={current.phone}
            onChange={(event) => patch({ phone: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.jobTitle")}
            value={current.jobTitle}
            onChange={(event) => patch({ jobTitle: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.company")}
            value={current.companyText}
            onChange={(event) => patch({ companyText: event.target.value })}
          />
          <FieldBox
            label={t("eventRegistration.fields.socialProfile")}
            type="url"
            inputMode="url"
            className="sm:col-span-2"
            value={current.socialProfileUrl}
            invalid={errorOf.has("socialProfileUrl")}
            onChange={(event) => patch({ socialProfileUrl: event.target.value })}
          />
        </div>
        <FieldErrors
          messages={["firstName", "lastName", "email", "socialProfileUrl"]
            .map((field) => errorOf.get(field))
            .filter((entry): entry is string => entry !== undefined)}
        />
      </section>

      {form.tickets.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("eventRegistration.sections.ticket")}
          </h2>
          <RegistrationTicketPicker
            tickets={form.tickets}
            value={current.ticketTypeId}
            lang={lang}
            invalid={errorOf.has("ticketTypeId")}
            onChange={(ticketId) => patch({ ticketTypeId: ticketId })}
          />
          <FieldErrors
            messages={[errorOf.get("ticketTypeId")].filter(
              (entry): entry is string => entry !== undefined,
            )}
          />
        </section>
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

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submit.isPending}>
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
