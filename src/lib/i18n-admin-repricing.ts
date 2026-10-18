// i18n karty „Przeniesienie subskrypcji na cennik v6.2" w panelu rozliczeń (PL/EN).
//
// Osobna nakładka zamiast dopisku do `i18n-admin-billing.ts`, jak przy dawnych
// anulowaniach: akcja dotyczy jednej kampanii cennika i zniknie razem z kartą,
// a słownik panelu zostaje. Prefiks jest pod twardą bramką parytetu
// (`i18nParity.gate.test.ts`) - to powierzchnia pieniężna, na której admin
// decyduje o cenach klientów, więc surowy klucz zamiast zdania nie przejdzie.
import i18n from "@/lib/i18n";

const pl = {
  adminRepricing: {
    title: "Przeniesienie subskrypcji na cennik v6.2",
    lead: "Obecni członkowie progów Członek, Członek Pro i Zespół płacą niższą cenę v6.2 od najbliższego odnowienia. Bieżący, opłacony okres zostaje bez zmian - bez proraty i bez dodatkowej faktury. Najpierw podgląd (niczego nie zapisuje), potem wykonanie z potwierdzeniem. E-mail o niższej cenie dostaje przeniesiony członek, którego kwota realnie spada i którego odnowienie nie jest anulowane.",
    preview: "Przelicz podgląd",
    execute: "Wykonaj przeniesienie",
    resume: "Kontynuuj",
    running: "Przetwarzanie...",
    showLog: "Pokaż dziennik",
    hideLog: "Ukryj dziennik",
    executeHint: "Wykonanie odblokowuje się po pełnym podglądzie bez rozjazdów cennika.",
    confirmTitle: "Przenieść subskrypcje na niższe ceny v6.2?",
    confirmDescription:
      "Pozycje subskrypcji u operatora płatności dostaną nowe ceny od najbliższej faktury, a członkowie, których kwota realnie spada - e-mail o niższej cenie. Operacji nie da się cofnąć jednym kliknięciem. Aby potwierdzić, wpisz: {{phrase}}",
    confirmLabel: "Fraza potwierdzenia",
    confirmCancel: "Anuluj",
    confirmAction: "Przenieś",
    summaryTitle: "Podsumowanie",
    summary:
      "Sprawdzono {{total}} subskrypcji, do przeniesienia: {{apply}}. MRR przed: {{before}}, po: {{after}}, różnica: {{delta}}.",
    mrrNote:
      "MRR w ekwiwalencie miesięcznym po cenach katalogowych, bez rabatów i podatku - wyłącznie subskrypcje przenoszone.",
    simulated: "Podgląd - niczego nie zapisano ani nie zmieniono u operatora.",
    unfinished: "Przebieg zatrzymał się przed końcem listy - kontynuuj, aby przejść resztę.",
    empty: "Brak subskrypcji objętych przeniesieniem.",
    rowsTruncated: "Pokazano {{shown}} z {{total}} pozycji.",
    failed: "Przebieg nie powiódł się: {{message}}",
    confirmationRequired: "Wykonanie wymaga wpisania frazy potwierdzenia.",
    environmentNotAllowed: "To środowisko płatności nie jest dostępne na tym wdrożeniu.",
    problemsTitle: "Wykonanie zablokowane - cennik u operatora nie zgadza się z v6.2",
    problems: {
      catalog_not_synced:
        "Katalog cen u operatora nie jest zsynchronizowany z cennikiem. Operator platformy uruchamia synchronizację katalogu w tym panelu.",
      target_price_missing: "Brak aktywnej ceny katalogu: {{key}}.",
      target_price_mismatch:
        "Cena katalogu {{key}} u operatora różni się od ceny planu w tym obszarze roboczym.",
    },
    columns: {
      subscription: "Subskrypcja",
      plan: "Plan",
      seats: "Miejsca",
      current: "Obecna cena",
      next: "Nowa cena",
      mrrDelta: "Zmiana MRR",
      effectiveAt: "Od",
      decision: "Decyzja",
      email: "E-mail",
    },
    outcomes: {
      planned: "do przeniesienia",
      applied: "przeniesiono",
      already_applied: "przeniesiono wcześniej",
      skipped: "pominięto",
      failed: "błąd",
    },
    reasons: {
      status_not_billable: "Płatność zaległa lub niedokończona - ponów po jej odzyskaniu",
      paused: "Pobór wstrzymany",
      pending_update: "Trwa nieopłacona zmiana planu",
      multi_item: "Kilka pozycji - obsługa ręczna",
      schedule_foreign: "Harmonogram spoza aplikacji - obsługa ręczna",
      cancel_scheduled:
        "Zaplanowana rezygnacja przy harmonogramie zmiany - bez przeniesienia (zapis faz odwołałby rezygnację)",
      not_repriced_key: "Plan spoza kampanii v6.2",
      target_price_missing: "Brak nowej ceny katalogu",
      already_current: "Cena już aktualna",
      currency_mismatch: "Inna waluta niż katalog",
      cycle_mismatch: "Inny cykl niż katalog",
      unpriceable: "Kształt ceny nieobsługiwany",
      would_increase: "Nowa cena byłaby wyższa - zostaje obecna",
      in_progress: "Przebieg przerwany w trakcie zmiany - ponów wykonanie, aby dokończyć",
      state_changed: "Stan subskrypcji zmienił się przed zmianą ceny",
      not_provider_subscription: "Subskrypcja spoza operatora płatności",
      provider_error: "Błąd operatora płatności - ponów wykonanie",
      no_subscription_item: "Subskrypcja bez pozycji u operatora",
      schedule_unreadable: "Nieczytelny harmonogram u operatora - obsługa ręczna",
      unknown: "Nieznany powód ({{code}})",
    },
    emailStatuses: {
      pending: "w kolejce do wysłania",
      queued: "wysłany do kolejki",
      skipped: "bez e-maila",
      failed: "nie wysłano - ponów wykonanie",
    },
    logTitle: "Dziennik przeniesień",
    logEmpty: "Dziennik jest pusty.",
    logColumns: {
      when: "Kiedy",
      subscription: "Subskrypcja",
      plan: "Plan",
      amounts: "Kwota przed → po",
      status: "Wynik",
      email: "E-mail",
    },
    logStatuses: {
      applied: "przeniesiono",
      skipped: "pominięto",
      failed: "błąd",
    },
  },
};

const en = {
  adminRepricing: {
    title: "Move subscriptions to the v6.2 price list",
    lead: "Current Member, Member Pro and Team members pay the lower v6.2 price from their next renewal. The current, paid period stays unchanged - no proration and no extra invoice. Run the preview first (it writes nothing), then execute with confirmation. A moved member receives an email about the lower price when their amount actually drops and their renewal is not cancelled.",
    preview: "Run preview",
    execute: "Execute the move",
    resume: "Continue",
    running: "Processing...",
    showLog: "Show log",
    hideLog: "Hide log",
    executeHint: "Execution unlocks after a full preview with no price-list mismatches.",
    confirmTitle: "Move subscriptions to the lower v6.2 prices?",
    confirmDescription:
      "Subscription items at the payment provider get the new prices from the next invoice, and members whose amount actually drops get an email about the lower price. The operation cannot be undone with one click. To confirm, type: {{phrase}}",
    confirmLabel: "Confirmation phrase",
    confirmCancel: "Cancel",
    confirmAction: "Move",
    summaryTitle: "Summary",
    summary:
      "Checked {{total}} subscriptions, to move: {{apply}}. MRR before: {{before}}, after: {{after}}, change: {{delta}}.",
    mrrNote:
      "MRR as a monthly equivalent at catalogue prices, before discounts and tax - only the subscriptions being moved.",
    simulated: "Preview - nothing was written or changed at the provider.",
    unfinished: "The run stopped before the end of the list - continue to process the rest.",
    empty: "No subscriptions are in scope for the move.",
    rowsTruncated: "Showing {{shown}} of {{total}} entries.",
    failed: "The run failed: {{message}}",
    confirmationRequired: "Execution requires typing the confirmation phrase.",
    environmentNotAllowed: "This payment environment is not available on this deployment.",
    problemsTitle: "Execution blocked - the provider's price list does not match v6.2",
    problems: {
      catalog_not_synced:
        "The provider's price catalogue is not in sync with the price list. The platform operator runs the catalogue sync in this panel.",
      target_price_missing: "No active catalogue price: {{key}}.",
      target_price_mismatch:
        "The catalogue price {{key}} at the provider differs from the plan price in this workspace.",
    },
    columns: {
      subscription: "Subscription",
      plan: "Plan",
      seats: "Seats",
      current: "Current price",
      next: "New price",
      mrrDelta: "MRR change",
      effectiveAt: "From",
      decision: "Decision",
      email: "Email",
    },
    outcomes: {
      planned: "to move",
      applied: "moved",
      already_applied: "moved earlier",
      skipped: "skipped",
      failed: "error",
    },
    reasons: {
      status_not_billable: "Payment overdue or incomplete - retry once it is recovered",
      paused: "Collection paused",
      pending_update: "An unpaid plan change is in progress",
      multi_item: "Several items - handle manually",
      schedule_foreign: "Schedule created outside the app - handle manually",
      cancel_scheduled:
        "Cancellation scheduled alongside a plan-change schedule - not moved (rewriting the phases would revoke the cancellation)",
      not_repriced_key: "Plan outside the v6.2 campaign",
      target_price_missing: "No new catalogue price",
      already_current: "Price already current",
      currency_mismatch: "Currency differs from the catalogue",
      cycle_mismatch: "Billing cycle differs from the catalogue",
      unpriceable: "Unsupported price shape",
      would_increase: "The new price would be higher - the current one stays",
      in_progress: "The run was interrupted during the change - execute again to finish it",
      state_changed: "The subscription changed before the price was moved",
      not_provider_subscription: "Subscription outside the payment provider",
      provider_error: "Payment provider error - execute again",
      no_subscription_item: "Subscription without an item at the provider",
      schedule_unreadable: "Unreadable schedule at the provider - handle manually",
      unknown: "Unknown reason ({{code}})",
    },
    emailStatuses: {
      pending: "waiting to be sent",
      queued: "handed to the queue",
      skipped: "no email",
      failed: "not sent - run the execution again",
    },
    logTitle: "Move log",
    logEmpty: "The log is empty.",
    logColumns: {
      when: "When",
      subscription: "Subscription",
      plan: "Plan",
      amounts: "Amount before → after",
      status: "Result",
      email: "Email",
    },
    logStatuses: {
      applied: "moved",
      skipped: "skipped",
      failed: "error",
    },
  },
};

let registered = false;

export function ensureAdminRepricingI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureAdminRepricingI18n();
