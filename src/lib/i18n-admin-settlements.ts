// i18n widoku stanów rozliczeń i zwrotów (PL/EN).
import i18n from "@/lib/i18n";

const pl = {
  adminSettlements: {
    title: "Stany rozliczeń i zwrotów",
    lead: "Zamówienia z ich stanem płatności, kwotą zwrotu i postępem automatycznego zwrotu.",
    from: "Od dnia",
    to: "Do dnia",
    status: "Status",
    all: "Wszystkie",
    apply: "Pokaż",
    loading: "Wczytywanie...",
    empty: "Brak rozliczeń dla wybranych filtrów.",
    truncated: "Pokazano 500 najnowszych pozycji - zawęź zakres dat.",
    count: "Pozycji: {{count}}",
    review: "Do sprawdzenia",
    columns: {
      date: "Data",
      order: "Zamówienie",
      status: "Status",
      amount: "Kwota",
      refunded: "Zwrócono",
      refundJob: "Zwrot automatyczny",
    },
    statuses: {
      pending: "Oczekuje",
      processing: "W toku",
      paid: "Opłacone",
      partially_refunded: "Zwrot częściowy",
      refunded: "Zwrócone",
      failed: "Nieudane",
      canceled: "Anulowane",
    },
    jobs: {
      pending: "W kolejce",
      processing: "W toku",
      done: "Wykonany",
      review: "Do sprawdzenia",
      failed: "Nieudany",
    },
  },
};

const en: typeof pl = {
  adminSettlements: {
    title: "Settlement and refund states",
    lead: "Orders with their payment state, refunded amount and automatic refund progress.",
    from: "From",
    to: "To",
    status: "Status",
    all: "All",
    apply: "Show",
    loading: "Loading...",
    empty: "No settlements match the selected filters.",
    truncated: "Showing the 500 most recent entries - narrow the date range.",
    count: "Entries: {{count}}",
    review: "Needs review",
    columns: {
      date: "Date",
      order: "Order",
      status: "Status",
      amount: "Amount",
      refunded: "Refunded",
      refundJob: "Automatic refund",
    },
    statuses: {
      pending: "Pending",
      processing: "Processing",
      paid: "Paid",
      partially_refunded: "Partially refunded",
      refunded: "Refunded",
      failed: "Failed",
      canceled: "Canceled",
    },
    jobs: {
      pending: "Queued",
      processing: "Processing",
      done: "Done",
      review: "Needs review",
      failed: "Failed",
    },
  },
};

let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
