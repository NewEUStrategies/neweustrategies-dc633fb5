// Molekuła: lista gości rejestracji grupowej (imię, nazwisko, e-mail każdej
// osoby). Prowadzący liczy się jako pierwsze miejsce, więc gości może być
// najwyżej `maxSize - 1`.
//
// `disabled` ZAMRAŻA LISTĘ NA CZAS WYSYŁKI. Ponowne dopisanie gości z ekranu
// potwierdzenia wysyła listę z chwili kliknięcia; poprawka wpisana w trakcie
// żądania zniknęłaby razem z edytorem po sukcesie, więc pola są wtedy
// zablokowane, a nie tylko przycisk.
//
// BEZ KONTA - ZDANIE I DROGA DO LOGOWANIA. `event_register_group_guests`
// odmawia anonimowi (`account_required`), więc gość bez konta zapisałby tylko
// siebie. Samo szare zdanie nie mówiło, co z tym zrobić; odnośnik jest ten sam,
// co przy płatnej wejściówce (`PaidTicketAccountNotice`).
import { Link } from "@tanstack/react-router";
import { LogIn, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_GUEST, type GroupGuest, type GuestIssue } from "@/lib/events/ticketTaxGroup";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

interface GroupGuestsEditorProps {
  guests: GroupGuest[];
  issues: (GuestIssue | null)[];
  maxSize: number;
  requiresAccount: boolean;
  /** Lista zablokowana (np. w trakcie wysyłki) - bez edycji, dodawania i usuwania. */
  disabled?: boolean;
  onChange: (next: GroupGuest[]) => void;
}

export function GroupGuestsEditor({
  guests,
  issues,
  maxSize,
  requiresAccount,
  disabled = false,
  onChange,
}: GroupGuestsEditorProps) {
  const { t } = useTranslation();
  const canAdd = guests.length < maxSize - 1;
  const update = (index: number, next: Partial<GroupGuest>) =>
    onChange(guests.map((g, i) => (i === index ? { ...g, ...next } : g)));

  return (
    <section className="space-y-4" aria-labelledby="group-guests-title">
      <div className="space-y-1">
        <h2 id="group-guests-title" className="text-lg font-semibold text-foreground">
          {t("eventRegistration.group.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.group.lead", { max: maxSize })}
        </p>
      </div>
      {requiresAccount ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">
            {t("eventRegistration.group.accountRequired")}
          </p>
          <Link
            to="/login"
            search={{ mode: "signin" }}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {t("eventRegistration.group.signIn")}
          </Link>
        </div>
      ) : (
        <>
          {guests.map((guest, index) => {
            const issue = issues[index] ?? null;
            const base = `group-guest-${index}`;
            return (
              <fieldset
                key={base}
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]"
              >
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  {t("eventRegistration.group.person", { n: index + 2 })}
                </legend>
                <div className="space-y-1">
                  <Label htmlFor={`${base}-first`}>{t("eventRegistration.fields.firstName")}</Label>
                  <Input
                    id={`${base}-first`}
                    value={guest.firstName}
                    disabled={disabled}
                    aria-invalid={issue === "name"}
                    onChange={(e) => update(index, { firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${base}-last`}>{t("eventRegistration.fields.lastName")}</Label>
                  <Input
                    id={`${base}-last`}
                    value={guest.lastName}
                    disabled={disabled}
                    aria-invalid={issue === "name"}
                    onChange={(e) => update(index, { lastName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${base}-email`}>{t("eventRegistration.fields.email")}</Label>
                  <Input
                    id={`${base}-email`}
                    type="email"
                    value={guest.email}
                    disabled={disabled}
                    aria-invalid={issue === "email" || issue === "duplicate"}
                    onChange={(e) => update(index, { email: e.target.value })}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={t("eventRegistration.group.remove")}
                    onClick={() => onChange(guests.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                {issue !== null && (
                  <p role="alert" className="text-sm text-destructive sm:col-span-4">
                    {t(`eventRegistration.group.issues.${issue}`)}
                  </p>
                )}
              </fieldset>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !canAdd}
            onClick={() => onChange([...guests, { ...EMPTY_GUEST }])}
          >
            <Plus className="mr-2 size-4" aria-hidden />
            {t("eventRegistration.group.add")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("eventRegistration.group.seats", { count: guests.length + 1 })}
          </p>
        </>
      )}
    </section>
  );
}
