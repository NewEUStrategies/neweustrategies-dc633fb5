import { describe, it, expect } from "vitest";

import {
  emailCategoryForLabel,
  suppressionBlocks,
  suppressionSkipReason,
  TX_EMAIL_CATEGORY,
  txEmailCategory,
  type SuppressionReason,
} from "../suppressionPolicy";
import { TX_EMAIL_TYPES } from "@/lib/email-templates/tx-copy";

const ALL_REASONS: readonly SuppressionReason[] = [
  "hard_bounce",
  "soft_bounce",
  "complaint",
  "manual",
  "unsubscribe",
  "invalid",
  "blocked",
];

describe("suppressionBlocks - wysyłka masowa", () => {
  it("zatrzymuje KAŻDY powód blokady", () => {
    // Wysyłka za zgodą nie ma żadnego powodu przechodzić przez blokadę:
    // niezależnie od jej źródła adres nie chce albo nie może jej odebrać.
    for (const reason of ALL_REASONS) {
      expect(suppressionBlocks({ reason, category: "bulk" })).toBe(true);
    }
  });
});

describe("suppressionBlocks - poczta transakcyjna", () => {
  it("zatrzymuje skargę i twarde odbicie", () => {
    // Skarga na spam to najgorszy sygnał reputacyjny, jaki nadawca może zebrać,
    // i kosztuje dostarczalność CAŁEJ domeny - także poczty, której nie wolno
    // stracić. Twarde odbicie oznacza skrzynkę, która nie istnieje.
    for (const reason of ["complaint", "hard_bounce", "blocked", "invalid"] as const) {
      expect(suppressionBlocks({ reason, category: "transactional" })).toBe(true);
    }
  });

  it("zatrzymuje blokadę ręczną operatora", () => {
    // Ręczny wpis to jawna decyzja zespołu (spamtrap, nadużycie) - nie wolno jej
    // obchodzić kategorią wiadomości.
    expect(suppressionBlocks({ reason: "manual", category: "transactional" })).toBe(true);
  });

  it("PRZEPUSZCZA wypis z newslettera", () => {
    // Wycofanie zgody marketingowej nie jest oświadczeniem "nie chcę
    // potwierdzeń płatności": tę treść dostarczamy z tytułu wykonania umowy.
    expect(suppressionBlocks({ reason: "unsubscribe", category: "transactional" })).toBe(false);
  });

  it("PRZEPUSZCZA miękkie odbicie", () => {
    // Blokada czasowa (pełna skrzynka) nie może cicho skasować ostrzeżenia o
    // nieudanej płatności na kilka dni; miękkie odbicia nie ważą na reputacji
    // tak jak twarde.
    expect(
      suppressionBlocks({ reason: "soft_bounce", scope: "transient", category: "transactional" }),
    ).toBe(false);
  });
});

describe("TX_EMAIL_CATEGORY", () => {
  it("pokrywa WSZYSTKIE typy maila transakcyjnego", () => {
    // Regresja, którą naprawia ta zmiana: suppression działała dla 1 z 19 typów.
    // Ten test pilnuje, że każdy typ ze słownika treści ma jawnie przypisaną
    // kategorię i że obie listy nie rozjadą się przy dodaniu nowego maila.
    expect(TX_EMAIL_TYPES.length).toBe(22);
    expect(Object.keys(TX_EMAIL_CATEGORY).sort()).toEqual([...TX_EMAIL_TYPES].sort());
    for (const type of TX_EMAIL_TYPES) {
      expect(TX_EMAIL_CATEGORY[type]).toMatch(/^(transactional|bulk)$/);
    }
  });

  it("skarga na spam zatrzymuje KAŻDY typ - żaden nie jest bezwarunkowy", () => {
    for (const type of TX_EMAIL_TYPES) {
      expect(suppressionBlocks({ reason: "complaint", category: txEmailCategory(type) })).toBe(
        true,
      );
    }
  });

  it("potwierdzenie zapisu na newsletter jest wysyłką za zgodą", () => {
    expect(txEmailCategory("newsletter_confirmed")).toBe("bulk");
    expect(
      suppressionBlocks({
        reason: "unsubscribe",
        category: txEmailCategory("newsletter_confirmed"),
      }),
    ).toBe(true);
  });

  it("maile o pieniądzach i dostępie są transakcyjne", () => {
    for (const type of [
      "payment_failed",
      "payment_refunded",
      "subscription_renewal_reminder",
      "team_seat_access_ended",
      "customer_portal_link",
      "donation_received",
      "event_registered",
    ] as const) {
      expect(txEmailCategory(type)).toBe("transactional");
    }
  });
});

describe("emailCategoryForLabel", () => {
  it("rozpoznaje etykiety kanałów masowych", () => {
    expect(emailCategoryForLabel("digest_daily")).toBe("bulk");
    expect(emailCategoryForLabel("digest_weekly")).toBe("bulk");
  });

  it("rozpoznaje kolejkę i etykiety autoryzacyjne", () => {
    // Link do logowania i reset hasła: odbiorca właśnie o nie poprosił i bez
    // nich nie wejdzie na konto.
    expect(emailCategoryForLabel("auth_emails")).toBe("transactional");
    expect(emailCategoryForLabel("auth_magic_link")).toBe("transactional");
    expect(emailCategoryForLabel("auth_recovery")).toBe("transactional");
  });

  it("rozpoznaje typy transakcyjne i nazwy z rejestru szablonów", () => {
    expect(emailCategoryForLabel("payment_failed")).toBe("transactional");
    // Rejestr używa myślników, typy podkreśleń - obie postacie muszą trafiać
    // w tę samą regułę.
    expect(emailCategoryForLabel("subscription-renewed")).toBe("transactional");
    expect(emailCategoryForLabel("newsletter-confirmed")).toBe("bulk");
    // Warianty językowe rejestru.
    expect(emailCategoryForLabel("donation-received-pl")).toBe("transactional");
    expect(emailCategoryForLabel("free-rsvp-en")).toBe("transactional");
  });

  it("fail-safe: nieznana etykieta jest traktowana jako masowa", () => {
    // Ostrożniej, nie luźniej: nowy kanał bez wpisu ma respektować każdą blokadę.
    expect(emailCategoryForLabel("something_new")).toBe("bulk");
    expect(emailCategoryForLabel("")).toBe("bulk");
    expect(emailCategoryForLabel(null)).toBe("bulk");
    expect(emailCategoryForLabel(undefined)).toBe("bulk");
  });
});

describe("suppressionSkipReason", () => {
  it("buduje stabilny kod przyczyny do logu", () => {
    expect(suppressionSkipReason("hard_bounce")).toBe("suppressed:hard_bounce");
    expect(suppressionSkipReason("complaint")).toBe("suppressed:complaint");
  });
});
