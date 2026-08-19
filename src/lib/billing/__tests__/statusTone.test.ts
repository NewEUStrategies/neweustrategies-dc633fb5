// Tonacja stanu płatności - bramka po scaleniu trzech rozjechanych kopii.
//
// DEFEKT NAPRAWIONY 19.08.2026. Ta sama decyzja istniała w TRZECH kopiach,
// każda z innym zestawem stanów „czerwonych":
//
//   BillingDocumentsCard   refunded, void
//   OrdersTableCard        failed, refunded, canceled
//   PaymentHistoryCard     failed, refunded, canceled, void
//
// Skutek dla klienta: nieudana płatność (`failed`) świeciła się na czerwono
// w historii, a w dokumentach wyglądała neutralnie; anulowany dokument (`void`)
// odwrotnie. Klient nie ma jak zgadnąć, która karta mówi prawdę - a to strona,
// na której sprawdza, czy zapłacił.
import { describe, expect, it } from "vitest";

import { isFailedPaymentStatus, paymentStatusTone } from "@/lib/billing/statusTone";

describe("paymentStatusTone - jeden kolor na stan, wszędzie", () => {
  it("opłacone wygląda na udane", () => {
    expect(paymentStatusTone("paid")).toBe("default");
  });

  it.each(["failed", "refunded", "canceled", "void"])(
    "„%s” jest CZERWONE - suma trzech dawnych kopii",
    (status) => {
      expect(paymentStatusTone(status)).toBe("destructive");
      expect(isFailedPaymentStatus(status)).toBe(true);
    },
  );

  it.each(["pending", "processing", "draft", "open"])(
    "„%s” jest NEUTRALNE - to stan przejściowy, nie problem",
    (status) => {
      expect(paymentStatusTone(status)).toBe("secondary");
      expect(isFailedPaymentStatus(status)).toBe(false);
    },
  );

  it("NIEZNANY stan jest neutralny, nie czerwony", () => {
    // Nowy stan dodany po stronie operatora nie może wyglądać jak awaria,
    // dopóki nie zdecydujemy, czym jest.
    expect(paymentStatusTone("nowy_stan_operatora")).toBe("secondary");
    expect(isFailedPaymentStatus("nowy_stan_operatora")).toBe(false);
  });

  it("pusty stan nie wywraca funkcji", () => {
    expect(paymentStatusTone("")).toBe("secondary");
    expect(isFailedPaymentStatus("")).toBe(false);
  });

  it("wielkość liter ma znaczenie - stany z bazy są małymi literami", () => {
    // Przypięcie stanu: „PAID" nie jest „paid". Gdyby operator zaczął
    // przysyłać wielkie litery, kolor byłby neutralny, a nie zielony -
    // widoczne od razu, zamiast po cichu.
    expect(paymentStatusTone("PAID")).toBe("secondary");
  });
});
