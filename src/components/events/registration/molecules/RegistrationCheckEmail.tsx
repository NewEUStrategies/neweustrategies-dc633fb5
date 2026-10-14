// Molekuła: „Sprawdź skrzynkę" - ekran po zapisie dla każdego, kto NIE jest
// zweryfikowanym właścicielem adresu (REG-04, decyzja D3).
//
// TO SAMO ZDANIE DLA „ZAPISANO" I „JUŻ ZAPISANY". Serwer odpowiada wtedy
// stałym `check_email`, a wynik wysyła mailem: potwierdzenie z odnośnikiem
// samoobsługi albo wiadomość do właściciela adresu, który już ma zgłoszenie.
// Ekran, który mówiłby cokolwiek więcej - status, kolejkę, klucz, przycisk
// rezygnacji albo kasy - zdradzałby, czy dany adres jest na liście, a klucz
// samoobsługi dawałby obcemu władzę nad cudzym zgłoszeniem.
//
// ADRES POKAZUJEMY TEN, KTÓRY WPISANO. Przychodzi z formularza (to, co
// uczestnik właśnie napisał), nie z odpowiedzi bazy - pozwala zauważyć
// literówkę, a niczego nowego nie ujawnia.
//
// ZGODY DO POTWIERDZENIA. Zaznaczona zgoda marketingowa albo na przekazanie
// partnerom działa dopiero po kliknięciu w osobny mail (double opt-in, D5) -
// mówimy o tym, gdy uczestnik coś zaznaczył, bo bez tego zdania drugi mail
// wyglądałby na spam.
import { MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export function RegistrationCheckEmail({
  email,
  consentPending,
}: {
  /** Adres wpisany w formularzu. */
  email: string;
  /** Uczestnik zaznaczył zgodę marketingową albo na przekazanie partnerom. */
  consentPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-live="polite"
      aria-labelledby="registration-check-email-title"
      className="space-y-3 rounded-[6px] border border-primary/40 bg-primary/5 p-4"
    >
      <h2
        id="registration-check-email-title"
        className="flex items-center gap-2 text-base font-semibold text-foreground"
      >
        <MailCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {t("eventRegistration.result.checkEmailTitle")}
      </h2>
      <p className="text-sm text-foreground">
        {t("eventRegistration.result.checkEmail", { email })}
      </p>
      {consentPending && (
        <p className="text-sm text-muted-foreground">
          {t("eventRegistration.result.checkEmailConsent")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("eventRegistration.result.checkEmailHint")}
      </p>
    </section>
  );
}
