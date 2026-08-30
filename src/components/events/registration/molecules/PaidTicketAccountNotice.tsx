// Molekuła: „ta wejściówka jest płatna, a płatna wymaga konta".
//
// STOI PRZY WYBORZE BILETU, A NIE PRZY PRZYCISKU. Człowiek ma to zobaczyć,
// ZANIM wypełni cały formularz - inaczej dowiedziałby się o wymogu po
// przepisaniu danych, odpowiedzi na pytania organizatora i zaznaczeniu zgód.
//
// TO JEST PODPOWIEDŹ, NIE BRAMKA. Prawdziwą bramką jest `event_register`,
// które od migracji `20260830090000` odrzuca anonimowy zapis na wejściówkę
// płatną (`payment_account_required`). Gdyby ten komponent zniknął, nic się
// nie rozszczelni - zmieni się tylko to, że uczestnik zobaczy odmowę zamiast
// uprzedzenia.
//
// TE SAME NAPISY, CO PRZY KASIE. Zdanie o paragonie i zwrocie mówi POWÓD -
// „zaloguj się" bez powodu brzmi jak arbitralna przeszkoda, a nią nie jest.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { KeyRound, LogIn } from "lucide-react";

import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export function PaidTicketAccountNotice() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="space-y-2 rounded-[6px] border border-amber-500/50 bg-amber-500/5 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {t("eventRegistration.payment.accountRequiredTitle")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("eventRegistration.payment.accountRequiredBody")}
      </p>
      <Link
        to="/login"
        search={{ mode: "signin" }}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {t("eventRegistration.payment.signIn")}
      </Link>
    </div>
  );
}
