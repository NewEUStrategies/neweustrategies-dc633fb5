// i18n panelu uzgadniania płatności (PL/EN). Rejestracja przy imporcie, tak
// jak pozostałe moduły `i18n-*` w repo.
import i18n from "@/lib/i18n";

const pl = {
  adminReconcile: {
    title: "Uzgadnianie płatności",
    lead: "Porównuje zdarzenia, zamówienia i subskrypcje u operatora płatności ze stanem w bazie. Naprawa uruchamia tę samą, idempotentną obsługę co webhook.",
    environment: "Środowisko",
    sandbox: "Testowe",
    live: "Produkcyjne",
    window: "Zakres (godziny)",
    scan: "Skanuj",
    scanning: "Skanowanie...",
    repair: "Napraw",
    repairing: "Naprawianie...",
    clean: "Brak rozbieżności w wybranym zakresie.",
    scanned: "Sprawdzono: {{events}} zdarzeń, {{orders}} zamówień, {{subs}} subskrypcji.",
    columns: {
      kind: "Rodzaj",
      reference: "Identyfikator",
      reason: "Powód",
      occurredAt: "Czas",
      action: "Akcja",
    },
    kinds: { event: "Zdarzenie", order: "Zamówienie", subscription: "Subskrypcja" },
    reasons: {
      event_missing: "Zdarzenie nie dotarło do aplikacji",
      event_failed: "Obsługa zdarzenia zakończyła się błędem",
      event_received: "Obsługa utknęła w trakcie",
      order_paid_not_fulfilled: "Płatność zaksięgowana u operatora, zamówienie nierozliczone",
      order_session_unreadable: "Nie udało się odczytać sesji płatności",
      subscription_status_drift: "Status subskrypcji różni się od operatora",
      subscription_unreadable: "Nie udało się odczytać subskrypcji",
    },
    warnings: {
      events_truncated: "Zakres zawiera więcej zdarzeń niż limit skanu - zawęź okno czasowe.",
    },
    outcome: {
      processed: "Naprawione",
      skipped: "Pominięte (nic do zrobienia)",
      failed: "Błąd naprawy",
    },
    notRepairable: "Wymaga ręcznej analizy",
  },
} as const;

const en = {
  adminReconcile: {
    title: "Payment reconciliation",
    lead: "Compares provider events, orders and subscriptions with the database. Repair replays the same idempotent handling as the webhook.",
    environment: "Environment",
    sandbox: "Test",
    live: "Live",
    window: "Window (hours)",
    scan: "Scan",
    scanning: "Scanning...",
    repair: "Repair",
    repairing: "Repairing...",
    clean: "No discrepancies in the selected window.",
    scanned: "Checked: {{events}} events, {{orders}} orders, {{subs}} subscriptions.",
    columns: {
      kind: "Type",
      reference: "Reference",
      reason: "Reason",
      occurredAt: "Time",
      action: "Action",
    },
    kinds: { event: "Event", order: "Order", subscription: "Subscription" },
    reasons: {
      event_missing: "Event never reached the app",
      event_failed: "Event handling failed",
      event_received: "Handling stalled mid-flight",
      order_paid_not_fulfilled: "Paid at the provider, order not fulfilled",
      order_session_unreadable: "Checkout session could not be read",
      subscription_status_drift: "Subscription status differs from the provider",
      subscription_unreadable: "Subscription could not be read",
    },
    warnings: {
      events_truncated: "The window holds more events than the scan limit - narrow the range.",
    },
    outcome: {
      processed: "Repaired",
      skipped: "Skipped (nothing to do)",
      failed: "Repair failed",
    },
    notRepairable: "Needs manual review",
  },
} as const;

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
