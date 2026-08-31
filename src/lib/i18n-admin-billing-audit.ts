// i18n panelu audytu rozliczeń (PL/EN). Rejestracja przy imporcie, tak jak
// pozostałe moduły `i18n-*` w repo.
import i18n from "@/lib/i18n";

const pl = {
  adminBillingAudit: {
    title: "Audyt rozliczeń",
    lead: "Historia zamówień i zdarzeń operatora płatności z naszej bazy - bez odpytywania Stripe. Eksport CSV/XLSX zawiera identyfikatory operatora, statusy i znaczniki czasu potrzebne do weryfikacji księgowej.",
    environment: "Środowisko",
    sandbox: "Testowe",
    live: "Produkcyjne",
    window: "Zakres (godziny)",
    eventFilter: "Wydarzenie (UUID, opcjonalnie)",
    load: "Wczytaj",
    loading: "Wczytywanie...",
    exportCsv: "Eksport CSV",
    exportXlsx: "Eksport XLSX",
    exporting: "Przygotowuję plik...",
    empty: "Brak danych w wybranym zakresie.",
    truncated: "Zakres przekracza limit wierszy - zawęź okno czasowe.",
    summary: {
      orders: "Zamówienia",
      paid: "Zaksięgowane",
      refunded: "Zwrócone",
      failed: "Nieudane zdarzenia",
    },
    tabs: { orders: "Zamówienia", webhooks: "Zdarzenia webhooków" },
    orders: {
      created: "Utworzone",
      status: "Status",
      kind: "Rodzaj",
      amount: "Kwota",
      refunded: "Zwrot",
      session: "Sesja",
      intent: "Intencja płatności",
      customer: "Klient",
    },
    webhooks: {
      occurred: "Czas zdarzenia",
      type: "Typ",
      status: "Status",
      retries: "Próby",
      duration: "Czas obsługi",
      error: "Błąd",
      retry: "Ponów",
      retrying: "Ponawianie...",
    },
    retryOk: "Ponowiono: {{status}}",
    retryFailed: "Ponowienie nie powiodło się: {{error}}",
    loadFailed: "Nie udało się wczytać audytu: {{error}}",
    exportFailed: "Eksport nie powiódł się: {{error}}",
  },
};

const en = {
  adminBillingAudit: {
    title: "Billing audit",
    lead: "Order and payment-provider event history straight from our database - no Stripe calls. The CSV/XLSX export carries provider identifiers, statuses and timestamps needed for accounting review.",
    environment: "Environment",
    sandbox: "Sandbox",
    live: "Live",
    window: "Window (hours)",
    eventFilter: "Event (UUID, optional)",
    load: "Load",
    loading: "Loading...",
    exportCsv: "Export CSV",
    exportXlsx: "Export XLSX",
    exporting: "Preparing file...",
    empty: "No data in the selected window.",
    truncated: "The window exceeds the row limit - narrow the time range.",
    summary: {
      orders: "Orders",
      paid: "Settled",
      refunded: "Refunded",
      failed: "Failed events",
    },
    tabs: { orders: "Orders", webhooks: "Webhook events" },
    orders: {
      created: "Created",
      status: "Status",
      kind: "Kind",
      amount: "Amount",
      refunded: "Refund",
      session: "Session",
      intent: "Payment intent",
      customer: "Customer",
    },
    webhooks: {
      occurred: "Occurred",
      type: "Type",
      status: "Status",
      retries: "Retries",
      duration: "Duration",
      error: "Error",
      retry: "Retry",
      retrying: "Retrying...",
    },
    retryOk: "Retried: {{status}}",
    retryFailed: "Retry failed: {{error}}",
    loadFailed: "Loading the audit failed: {{error}}",
    exportFailed: "Export failed: {{error}}",
  },
};

let registered = false;

/** Rejestruje słownik w chunku komponentu trasy (nie w entry aplikacji). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}

ensureI18n();
