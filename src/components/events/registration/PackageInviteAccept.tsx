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
// strona rezygnacji ze zgloszenia.
//
// STANY ODMOWY MOWIA JEZYKIEM DELEGATA. Baza rzuca `invalid_token`,
// `seat_taken`, `invitation_expired` i `order_cancelled`; mapper zapisow
// zamienia je na zdania, po ktorych wiadomo, czy prosic o nowy odnosnik,
// czy nie robic nic.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/field-box";
import {
  acceptPackageInvite,
  isPackageInviteToken,
  type PackageInviteAcceptResult,
} from "@/lib/events/packageInviteApi";
import { registrationErrorMessage } from "@/lib/events/publicRegistrationErrors";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export function PackageInviteAccept({ token }: { token: string | null }) {
  const { t } = useTranslation();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);

  const accept = useMutation<PackageInviteAcceptResult, unknown, string>({
    mutationFn: (activeToken: string) =>
      acceptPackageInvite({
        token: activeToken,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle.trim() === "" ? undefined : jobTitle.trim(),
        companyText: company.trim() === "" ? undefined : company.trim(),
        consentDataProcessing: consent,
      }),
  });

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
        <Link to="/events" className="inline-block text-sm text-primary hover:underline">
          {t("eventRegistration.invite.backToEvents")}
        </Link>
      </section>
    );
  }

  if (accept.isSuccess) {
    const result = accept.data;
    return (
      <section className="space-y-4" aria-live="polite">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("eventRegistration.invite.successTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.invite.successBody")}
        </p>

        {result.qrToken !== null && (
          <div className="space-y-1 rounded-[6px] border border-primary/40 bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Ticket className="h-4 w-4" aria-hidden="true" />
              {t("eventRegistration.invite.qrTitle")}
            </p>
            <code className="block break-all font-mono text-sm text-foreground">
              {result.qrToken}
            </code>
            <p className="text-xs text-muted-foreground">
              {t("eventRegistration.invite.qrHint")}
            </p>
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

        <Link to="/events" className="inline-block text-sm text-primary hover:underline">
          {t("eventRegistration.invite.backToEvents")}
        </Link>
      </section>
    );
  }

  const nameMissing = firstName.trim() === "" || lastName.trim() === "";
  const blocked = nameMissing || !consent || accept.isPending;

  return (
    <section className="space-y-6" aria-live="polite">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventRegistration.invite.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("eventRegistration.invite.subtitle")}</p>
      </header>

      <form
        className="space-y-4 rounded-[6px] border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (blocked) return;
          accept.mutate(token);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t("eventRegistration.fields.firstName")}
            value={firstName}
            autoComplete="given-name"
            onChange={(event) => setFirstName(event.target.value)}
          />
          <FieldBox
            label={t("eventRegistration.fields.lastName")}
            value={lastName}
            autoComplete="family-name"
            onChange={(event) => setLastName(event.target.value)}
          />
          <FieldBox
            label={t("eventRegistration.fields.jobTitle")}
            value={jobTitle}
            autoComplete="organization-title"
            onChange={(event) => setJobTitle(event.target.value)}
          />
          <FieldBox
            label={t("eventRegistration.fields.company")}
            value={company}
            autoComplete="organization"
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>

        {touched && nameMissing && (
          <p className="text-sm text-destructive">{t("eventRegistration.errors.invalidName")}</p>
        )}

        <label className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox
            checked={consent}
            onCheckedChange={(value) => setConsent(value === true)}
            aria-label={t("eventRegistration.consents.dataProcessing")}
          />
          <span>{t("eventRegistration.consents.dataProcessing")}</span>
        </label>
        {touched && !consent && (
          <p className="text-sm text-destructive">
            {t("eventRegistration.validation.dataProcessing")}
          </p>
        )}

        {accept.isError && (
          <p className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {registrationErrorMessage(accept.error)}
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
