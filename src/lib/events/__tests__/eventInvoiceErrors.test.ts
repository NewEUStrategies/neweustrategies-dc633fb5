// Odmowy bazy przy fakturach -> zdanie po ludzku (studio i kupujacy).
//
// Klucz musi ISTNIEC w slowniku (inaczej ekran pokazuje surowa sciezke i18n),
// wyscig na indeksie unikalnym to ta sama odmowa co `already_invoiced`, a
// komunikat spoza kontraktu bazy nie udaje znanego bledu. Kompletnosc map
// wzgledem wszystkich kodow SQL pilnuje `eventErrorMapsI18n.gate.test.ts`.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import {
  adminEventInvoiceErrorKey,
  adminEventInvoiceErrorMessage,
} from "@/lib/events/adminEventInvoiceErrors";
import { eventInvoiceErrorKey, eventInvoiceErrorMessage } from "@/lib/events/eventInvoiceErrors";

describe("adminEventInvoiceErrorKey", () => {
  it("glowa plpgsql -> camelCase klucza, ktory istnieje", () => {
    for (const [message, key] of [
      ["already_invoiced: an order already has an active invoice", "alreadyInvoiced"],
      ["mor_seller_conflict: card orders", "morSellerConflict"],
      ["vat_exempt_basis_required: x", "vatExemptBasisRequired"],
      ["ksef_locked: sent", "ksefLocked"],
      ["forbidden: admin role required", "forbidden"],
    ] as const) {
      const full = `adminEventInvoices.errors.${key}`;
      expect(adminEventInvoiceErrorKey(new Error(message))).toBe(full);
      expect(i18n.exists(full)).toBe(true);
    }
  });

  it("wyscig dwoch adminow na indeksie zrodel = juz zafakturowane", () => {
    expect(
      adminEventInvoiceErrorKey(
        'duplicate key value violates unique constraint "event_invoice_sources_registration_once"',
      ),
    ).toBe("adminEventInvoices.errors.alreadyInvoiced");
    expect(
      adminEventInvoiceErrorKey(new Error('duplicate key "event_invoice_sources_package_once"')),
    ).toBe("adminEventInvoices.errors.alreadyInvoiced");
  });

  it("nieznane, puste i nie-bledy = unknown", () => {
    for (const input of ["Failed to fetch", "", "Some Error: x", "made_up_code: x", 42, null, {}]) {
      expect(adminEventInvoiceErrorKey(input)).toBe("adminEventInvoices.errors.unknown");
    }
  });

  it("zdanie dla toasta jest przetlumaczone (nie surowy klucz)", () => {
    const message = adminEventInvoiceErrorMessage(new Error("not_draft: x"));
    expect(message).not.toBe("adminEventInvoices.errors.notDraft");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("eventInvoiceErrorKey (kupujacy)", () => {
  it("glowa -> klucz nakladki publicznej", () => {
    for (const [message, key] of [
      ["request_window_closed: too late", "requestWindowClosed"],
      ["already_invoiced: x", "alreadyInvoiced"],
      ["invalid_tax_id: x", "invalidTaxId"],
      ["rate_limited: too many", "rateLimited"],
      ["auth_required: sign in", "authRequired"],
    ] as const) {
      const full = `eventInvoices.errors.${key}`;
      expect(eventInvoiceErrorKey(new Error(message))).toBe(full);
      expect(eventInvoiceErrorKey(message)).toBe(full);
      expect(i18n.exists(full)).toBe(true);
    }
  });

  it("nieznane = unknown", () => {
    for (const input of ["Network down", "", "made_up: x", 7, undefined]) {
      expect(eventInvoiceErrorKey(input)).toBe("eventInvoices.errors.unknown");
    }
  });

  it("zdanie jest przetlumaczone", () => {
    expect(eventInvoiceErrorMessage("not_found: x")).not.toBe("eventInvoices.errors.notFound");
  });
});
