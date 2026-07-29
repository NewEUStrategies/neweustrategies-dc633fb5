import type { EmailLang } from "./nes-layout";
import type { PolishGender } from "@/lib/i18n/polishVocative";
import type { TxEmailType } from "./tx-copy";

/**
 * Pełna, spersonalizowana treść maili cyklu życia subskrypcji.
 *
 * `tx-copy` trzyma szkielet (temat, nagłówek, ikona, etykiety), a tutaj
 * powstają akapity zależne od realnych danych zdarzenia (nazwa planu, kwota,
 * daty okresu, prorata, okres karencji). Zdania po polsku odmieniają się przez
 * rodzaj gramatyczny odbiorcy - rodzaj pochodzi ze słownika imion, tego samego
 * co wołacz w powitaniu, więc mail nigdy nie miesza form.
 */

export interface TxBodyVars {
  /** Nazwa planu w języku odbiorcy. */
  planName?: string | null;
  previousPlanName?: string | null;
  /** Sformatowana kwota z walutą, np. "199,00 zł". */
  amount?: string | null;
  /** Sformatowana etykieta cyklu, np. "miesięcznie" / "monthly". */
  interval?: string | null;
  /** Sformatowana data kolejnego odnowienia. */
  renewsAt?: string | null;
  /** Sformatowana data końca opłaconego okresu / dostępu. */
  accessUntil?: string | null;
  /** Sformatowana data kolejnej próby obciążenia. */
  retryAt?: string | null;
  /** Liczba dni karencji przy nieudanej płatności. */
  graceDays?: number | null;
  /** Sformatowana kwota doliczonej proraty przy zmianie planu w trakcie okresu. */
  prorationAmount?: string | null;
  /** Wiadomość darczyńcy z formularza darowizny (już przycięta). */
  donorMessage?: string | null;
}

export interface TxBodyCopy {
  intro?: string;
  extra?: string;
  note?: string;
}

/** Męska / żeńska / neutralna (bezosobowa) wersja zdania. */
const g = (male: string, female: string, neutral: string, gender: PolishGender): string =>
  gender === "male" ? male : gender === "female" ? female : neutral;

const plan = (v: TxBodyVars, lang: EmailLang): string =>
  (v.planName ?? "").trim() || (lang === "pl" ? "wybranego planu" : "your plan");

type Builder = (v: TxBodyVars, gender: PolishGender) => TxBodyCopy;

const PL: Partial<Record<TxEmailType, Builder>> = {
  donation_received: (v, gender) => ({
    intro:
      `Dziękujemy za darowiznę${v.amount ? ` w kwocie ${v.amount}` : ""}. Twoje wsparcie finansuje niezależne analizy polityki europejskiej - bez paywalla tam, gdzie to możliwe.` +
      (v.donorMessage ? " Twoją wiadomość przekazaliśmy redakcji." : ""),
    extra: g(
      "Dołączyłeś do grona mecenasów New European Strategies.",
      "Dołączyłaś do grona mecenasów New European Strategies.",
      "Dołączyłeś/aś do grona mecenasów New European Strategies.",
      gender,
    ),
  }),
  subscription_confirmed: (v, gender) => {
    const price =
      v.amount && v.interval
        ? ` Kwota ${v.amount} jest rozliczana ${v.interval}.`
        : v.amount
          ? ` Kwota zamówienia to ${v.amount}.`
          : "";
    return {
      intro:
        `Dziękujemy - płatność za plan ${plan(v, "pl")} została zaksięgowana, a pełny dostęp do analiz, danych i materiałów eksperckich New European Strategies jest już aktywny na Twoim koncie.${price}` +
        (v.renewsAt ? ` Kolejne odnowienie nastąpi ${v.renewsAt}.` : ""),
      extra: g(
        "Od tej chwili możesz czytać wszystkie materiały premium, pobierać raporty w PDF i zapisywać się na wydarzenia dla subskrybentów - dostęp otrzymałeś natychmiast.",
        "Od tej chwili możesz czytać wszystkie materiały premium, pobierać raporty w PDF i zapisywać się na wydarzenia dla subskrybentów - dostęp otrzymałaś natychmiast.",
        "Od tej chwili dostępne są wszystkie materiały premium, raporty w PDF oraz zapisy na wydarzenia dla subskrybentów - dostęp został nadany natychmiast.",
        gender,
      ),
      note: "Fakturę, historię płatności i zarządzanie planem znajdziesz w profilu, w zakładce Subskrypcja. Subskrypcję możesz anulować w każdej chwili - dostęp zostaje do końca opłaconego okresu.",
    };
  },
  subscription_canceled: (v, gender) => ({
    intro:
      `Potwierdzamy rezygnację z planu ${plan(v, "pl")}. Kolejne płatności nie zostaną pobrane.` +
      (v.accessUntil
        ? ` Dostęp do materiałów premium pozostaje aktywny do ${v.accessUntil} - płacisz tylko za okres, z którego korzystasz.`
        : " Dostęp pozostaje aktywny do końca opłaconego okresu."),
    extra: g(
      "Jeśli zmienisz zdanie przed końcem okresu, możesz wznowić subskrypcję jednym kliknięciem - nie stracisz zapisanych materiałów ani historii czytania.",
      "Jeśli zmienisz zdanie przed końcem okresu, możesz wznowić subskrypcję jednym kliknięciem - nie stracisz zapisanych materiałów ani historii czytania.",
      "Subskrypcję można wznowić jednym kliknięciem przed końcem okresu - zapisane materiały i historia czytania pozostają nienaruszone.",
      gender,
    ),
    note: g(
      "Napisz nam, dlaczego rezygnujesz - Twoja odpowiedź realnie wpływa na to, co publikujemy.",
      "Napisz nam, dlaczego rezygnujesz - Twoja odpowiedź realnie wpływa na to, co publikujemy.",
      "Prosimy o krótką informację zwrotną - opinie subskrybentów realnie wpływają na to, co publikujemy.",
      gender,
    ),
  }),
  subscription_upgraded: (v, gender) => ({
    intro:
      `Twój plan został podniesiony${v.previousPlanName ? ` z ${v.previousPlanName}` : ""} do ${plan(v, "pl")}. Zmiana obowiązuje od razu - szerszy zakres materiałów jest już odblokowany.` +
      (v.prorationAmount
        ? ` Za pozostałą część bieżącego okresu doliczyliśmy proporcjonalną dopłatę w wysokości ${v.prorationAmount}.`
        : ""),
    extra:
      (v.amount && v.interval
        ? `Od kolejnego okresu rozliczeniowego kwota wyniesie ${v.amount} ${v.interval}.`
        : "") +
      (v.renewsAt ? ` Najbliższe odnowienie: ${v.renewsAt}.` : ""),
    note: g(
      "Nie musisz nic robić - wyższy poziom dostępu otrzymałeś automatycznie.",
      "Nie musisz nic robić - wyższy poziom dostępu otrzymałaś automatycznie.",
      "Nie są wymagane żadne działania - wyższy poziom dostępu został nadany automatycznie.",
      gender,
    ),
  }),
  subscription_downgraded: (v, gender) => ({
    intro:
      `Zapisaliśmy zmianę planu${v.previousPlanName ? ` z ${v.previousPlanName}` : ""} na ${plan(v, "pl")}.` +
      (v.accessUntil
        ? ` Do ${v.accessUntil} korzystasz z dotychczasowego zakresu dostępu - nowy plan zacznie obowiązywać od następnego okresu rozliczeniowego.`
        : " Nowy plan zacznie obowiązywać od następnego okresu rozliczeniowego."),
    extra:
      v.amount && v.interval
        ? `Od kolejnego okresu kwota subskrypcji wyniesie ${v.amount} ${v.interval}.`
        : undefined,
    note: g(
      "Jeśli chcesz zatrzymać dotychczasowy zakres, możesz cofnąć zmianę do końca bieżącego okresu.",
      "Jeśli chcesz zatrzymać dotychczasowy zakres, możesz cofnąć zmianę do końca bieżącego okresu.",
      "Zmianę można cofnąć do końca bieżącego okresu rozliczeniowego.",
      gender,
    ),
  }),
  payment_failed: (v, gender) => ({
    intro:
      `Nie udało nam się pobrać płatności za plan ${plan(v, "pl")}${v.amount ? ` na kwotę ${v.amount}` : ""}. Najczęstsze przyczyny to wygasła karta, przekroczony limit lub odrzucenie transakcji przez bank.` +
      (v.retryAt ? ` Ponowimy próbę ${v.retryAt}.` : ""),
    extra: g(
      `Nie tracisz dostępu - ${v.accessUntil ? `materiały premium pozostają aktywne do ${v.accessUntil}` : "materiały premium pozostają aktywne przez okres karencji"}${v.graceDays ? ` (${v.graceDays} dni karencji)` : ""}. Zaktualizuj metodę płatności, aby uniknąć przerwy w dostępie.`,
      `Nie tracisz dostępu - ${v.accessUntil ? `materiały premium pozostają aktywne do ${v.accessUntil}` : "materiały premium pozostają aktywne przez okres karencji"}${v.graceDays ? ` (${v.graceDays} dni karencji)` : ""}. Zaktualizuj metodę płatności, aby uniknąć przerwy w dostępie.`,
      `Dostęp pozostaje aktywny${v.accessUntil ? ` do ${v.accessUntil}` : " przez okres karencji"}${v.graceDays ? ` (${v.graceDays} dni karencji)` : ""}. Aktualizacja metody płatności zapobiegnie przerwie w dostępie.`,
      gender,
    ),
    note: g(
      "Jeśli płatność przejdzie przy kolejnej próbie, nie musisz robić nic więcej - poinformujemy Cię mailem.",
      "Jeśli płatność przejdzie przy kolejnej próbie, nie musisz robić nic więcej - poinformujemy Cię mailem.",
      "Jeśli kolejna próba zakończy się powodzeniem, wyślemy potwierdzenie mailem.",
      gender,
    ),
  }),
};

const EN: Partial<Record<TxEmailType, Builder>> = {
  donation_received: (v) => ({
    intro:
      `Thank you for your donation${v.amount ? ` of ${v.amount}` : ""}. Your support funds independent European policy analysis - kept outside the paywall wherever possible.` +
      (v.donorMessage ? " We have passed your message on to the editorial team." : ""),
    extra: "You are now part of the New European Strategies patron community.",
  }),
  subscription_confirmed: (v) => ({
    intro:
      `Thank you - your payment for the ${plan(v, "en")} plan has been processed and full access to New European Strategies analysis, data and expert briefings is now active on your account.` +
      (v.amount && v.interval ? ` You are billed ${v.amount} ${v.interval}.` : "") +
      (v.renewsAt ? ` Your next renewal is on ${v.renewsAt}.` : ""),
    extra:
      "From now on you can read every premium piece, download reports as PDF and register for subscriber-only events.",
    note: "Invoices, payment history and plan management live in your profile under Subscription. You can cancel at any time and keep access until the end of the paid period.",
  }),
  subscription_canceled: (v) => ({
    intro:
      `We have cancelled your ${plan(v, "en")} plan and no further payments will be taken.` +
      (v.accessUntil
        ? ` Premium access stays active until ${v.accessUntil} - you only pay for the period you use.`
        : " Access stays active until the end of the paid period."),
    extra:
      "If you change your mind before the period ends, you can resume in one click - your saved articles and reading history are kept.",
    note: "Tell us why you left - subscriber feedback directly shapes what we publish.",
  }),
  subscription_upgraded: (v) => ({
    intro:
      `Your plan has been upgraded${v.previousPlanName ? ` from ${v.previousPlanName}` : ""} to ${plan(v, "en")}. The change is effective immediately and the wider content set is already unlocked.` +
      (v.prorationAmount
        ? ` A pro-rated charge of ${v.prorationAmount} covers the remainder of the current period.`
        : ""),
    extra:
      (v.amount && v.interval ? `From the next billing period you pay ${v.amount} ${v.interval}.` : "") +
      (v.renewsAt ? ` Next renewal: ${v.renewsAt}.` : ""),
    note: "No action is needed - the higher access level was applied automatically.",
  }),
  subscription_downgraded: (v) => ({
    intro:
      `We have scheduled your plan change${v.previousPlanName ? ` from ${v.previousPlanName}` : ""} to ${plan(v, "en")}.` +
      (v.accessUntil
        ? ` You keep your current access until ${v.accessUntil}; the new plan starts with the next billing period.`
        : " The new plan starts with the next billing period."),
    extra:
      v.amount && v.interval
        ? `From the next period your subscription will be ${v.amount} ${v.interval}.`
        : undefined,
    note: "You can revert the change any time before the current period ends.",
  }),
  payment_failed: (v) => ({
    intro:
      `We could not take the payment for your ${plan(v, "en")} plan${v.amount ? ` of ${v.amount}` : ""}. The usual causes are an expired card, an exceeded limit or a bank decline.` +
      (v.retryAt ? ` We will retry on ${v.retryAt}.` : ""),
    extra: `You are not losing access - premium content stays active${v.accessUntil ? ` until ${v.accessUntil}` : " during the grace period"}${v.graceDays ? ` (${v.graceDays}-day grace period)` : ""}. Update your payment method to avoid an interruption.`,
    note: "If the next attempt succeeds, there is nothing else to do - we will confirm it by email.",
  }),
};

const DICTS: Record<EmailLang, Partial<Record<TxEmailType, Builder>>> = { pl: PL, en: EN };

/** Spersonalizowane akapity dla danego zdarzenia; puste, gdy brak wariantu. */
export function txBody(
  type: TxEmailType,
  lang: EmailLang,
  gender: PolishGender,
  vars: TxBodyVars,
): TxBodyCopy {
  const build = DICTS[lang][type];
  if (!build) return {};
  const out = build(vars, lang === "pl" ? gender : "unknown");
  const clean = (s?: string): string | undefined => {
    const t = (s ?? "").trim();
    return t ? t : undefined;
  };
  return { intro: clean(out.intro), extra: clean(out.extra), note: clean(out.note) };
}
