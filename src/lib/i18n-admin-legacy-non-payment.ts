// i18n karty „Dawne anulowania za brak płatności" w panelu rozliczeń (PL/EN).
//
// Osobna nakładka zamiast dopisku do `i18n-admin-billing.ts`: zadanie jest
// jednorazowe i zniknie razem z kartą, a słownik panelu zostaje. Rejestracja
// przy imporcie i idempotentne `ensure…I18n()` - jak w pozostałych `i18n-*`.
import i18n from "@/lib/i18n";

const pl = {
  adminLegacyNonPayment: {
    title: "Dawne anulowania za brak płatności",
    lead: "Jednorazowe uzgodnienie subskrypcji anulowanych za brak płatności przed regułą 14-dniowej karencji. Dostęp zostaje przycięty do końca karencji, a gdy ta minęła - odebrany. Rezygnacje klientów, zwroty i anulowania bez dowodu braku płatności zostają bez zmian. Domyślnie symulacja; zapis wymaga potwierdzenia.",
    dryRun: "Symulacja",
    apply: "Zastosuj",
    resume: "Kontynuuj",
    running: "Przetwarzanie...",
    confirmTitle: "Zastosować przycięcie dostępu?",
    confirmDescription:
      "Zadanie obejmuje subskrypcje wszystkich najemców tego środowiska. Zapis wyłącznie skraca dostęp i można go powtórzyć bez skutków ubocznych. Klienci nie dostaną wiadomości.",
    summary:
      "Sprawdzono {{scanned}} anulowanych subskrypcji, z dostępem do uzgodnienia: {{candidates}}.",
    writes:
      "Zapisano: kotwice karencji {{anchors}}, uprawnienia {{entitlements}}, zespoły {{teams}}.",
    simulated: "Symulacja - niczego nie zapisano.",
    unfinished: "Przebieg zatrzymał się przed końcem listy - kontynuuj, aby przejść resztę.",
    empty: "Brak anulowanych subskrypcji z dostępem do uzgodnienia.",
    rowsTruncated: "Pokazano {{shown}} z {{total}} pozycji.",
    platformOnly: "Uzgodnienie obejmuje wszystkich najemców - uruchamia je operator platformy.",
    failed: "Uzgodnienie nie powiodło się: {{message}}",
    applied: "zapisano",
    teamSuspended: "zespół zawieszony",
    columns: {
      subscription: "Subskrypcja",
      decision: "Decyzja",
      before: "Dostęp przed",
      after: "Dostęp po",
      detail: "Szczegóły",
    },
    noEnd: "bez końca",
    paymentProof: {
      invoice: "faktura opłacona",
      ledger: "zapłata zaksięgowana w okresie",
    },
    decisions: {
      clamp: "Przycięte do końca karencji",
      revoke: "Karencja minęła - dostęp odebrany",
      already_clamped: "Już zgodne z karencją",
      voluntary: "Rezygnacja klienta - bez zmian",
      paid: "Okres opłacony po anulowaniu - bez zmian",
      no_evidence: "Brak dowodu braku płatności - bez zmian",
      refunded: "Zwrot - bez zmian",
      stripe_missing: "Nieznana operatorowi - pominięta",
      stripe_not_canceled: "U operatora nie jest anulowana - pominięta",
      error: "Błąd",
    },
  },
};

const en = {
  adminLegacyNonPayment: {
    title: "Legacy non-payment cancellations",
    lead: "One-off reconciliation of subscriptions canceled for non-payment before the 14-day grace rule. Access is clamped to the end of the grace period, or removed when the grace period is already over. Customer cancellations, refunds and cancellations without evidence of non-payment stay unchanged. Runs as a simulation by default; applying requires confirmation.",
    dryRun: "Simulate",
    apply: "Apply",
    resume: "Continue",
    running: "Processing...",
    confirmTitle: "Apply the access clamp?",
    confirmDescription:
      "This covers subscriptions of every organisation in this environment. It only ever shortens access and can be repeated safely. Customers are not notified.",
    summary:
      "Checked {{scanned}} canceled subscriptions, with access to reconcile: {{candidates}}.",
    writes: "Written: grace anchors {{anchors}}, entitlements {{entitlements}}, teams {{teams}}.",
    simulated: "Simulation - nothing was written.",
    unfinished: "The run stopped before the end of the list - continue to process the rest.",
    empty: "No canceled subscriptions with access to reconcile.",
    rowsTruncated: "Showing {{shown}} of {{total}} entries.",
    platformOnly:
      "This reconciliation covers every organisation - it is started by the platform operator.",
    failed: "Reconciliation failed: {{message}}",
    applied: "written",
    teamSuspended: "team suspended",
    columns: {
      subscription: "Subscription",
      decision: "Decision",
      before: "Access before",
      after: "Access after",
      detail: "Details",
    },
    noEnd: "no end",
    paymentProof: {
      invoice: "invoice paid",
      ledger: "payment recorded in the period",
    },
    decisions: {
      clamp: "Clamped to the end of the grace period",
      revoke: "Grace period over - access removed",
      already_clamped: "Already within the grace period",
      voluntary: "Customer cancellation - unchanged",
      paid: "Period paid after cancellation - unchanged",
      no_evidence: "No evidence of non-payment - unchanged",
      refunded: "Refunded - unchanged",
      stripe_missing: "Unknown to the provider - skipped",
      stripe_not_canceled: "Not canceled at the provider - skipped",
      error: "Error",
    },
  },
};

let registered = false;

export function ensureAdminLegacyNonPaymentI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureAdminLegacyNonPaymentI18n();
