// Nota retencyjna przy usuwaniu konta.
//
// Test celowo używa PRAWDZIWEJ instancji i18n (nie mocka react-i18next): jego
// wartością jest dowód, że klucze `profile.security.danger.retention*` istnieją
// w OBU językach. Z mockiem `t` zwracającym klucz literówka w nazwie klucza
// przeszłaby niezauważona, a wtedy użytkownik zobaczyłby w dialogu surowy
// identyfikator zamiast podstawy prawnej retencji.
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-profile";
import { LegalRetentionNotice } from "@/components/molecules/LegalRetentionNotice";

const KEYS = [
  "profile.security.danger.retentionTitle",
  "profile.security.danger.retentionBody",
  "profile.security.danger.retentionBasis",
] as const;

beforeAll(() => {
  ensureI18n();
});

describe("LegalRetentionNotice", () => {
  it("po polsku podaje podstawę prawną retencji (art. 74 uor + art. 17 RODO)", async () => {
    await i18n.changeLanguage("pl");
    render(<LegalRetentionNotice />);

    const notice = screen.getByTestId("legal-retention-notice");
    expect(notice.textContent).toContain("art. 74");
    expect(notice.textContent).toContain("art. 17 ust. 3 lit. b RODO");
    // Sedno komunikatu: historia płatności zostaje, ale traci związek z osobą.
    expect(notice.textContent).toContain("pseudonim");
    // Żaden klucz nie wyciekł jako surowy identyfikator.
    for (const key of KEYS) expect(notice.textContent).not.toContain(key);
  });

  it("po angielsku podaje ten sam wyjątek w wersji GDPR", async () => {
    await i18n.changeLanguage("en");
    render(<LegalRetentionNotice />);

    const notice = screen.getByTestId("legal-retention-notice");
    expect(notice.textContent).toContain("Article 74(2)");
    expect(notice.textContent).toContain("Article 17(3)(b) GDPR");
    expect(notice.textContent).toContain("pseudonym");
    for (const key of KEYS) expect(notice.textContent).not.toContain(key);
  });

  it("wariant compact renderuje tę samą treść bez obudowy karty", async () => {
    await i18n.changeLanguage("pl");
    const { rerender } = render(<LegalRetentionNotice />);
    const card = screen.getByTestId("legal-retention-notice");
    const cardText = card.textContent;
    expect(card.className).toContain("border");

    rerender(<LegalRetentionNotice variant="compact" />);
    const compact = screen.getByTestId("legal-retention-notice");
    expect(compact.textContent).toBe(cardText);
    expect(compact.className).not.toContain("border");
  });

  it("komunikat po usunięciu odmienia liczebnik dowodów po polsku", async () => {
    await i18n.changeLanguage("pl");
    const key = "profile.security.danger.deletedWithRetention";
    // Polska fleksja: 1 dowód / 2 dowody / 5 dowodów - trzy różne formy.
    expect(i18n.t(key, { count: 1 })).toContain("1 zanonimizowany dowód");
    expect(i18n.t(key, { count: 2 })).toContain("2 zanonimizowane dowody");
    expect(i18n.t(key, { count: 5 })).toContain("5 zanonimizowanych dowodów");

    await i18n.changeLanguage("en");
    expect(i18n.t(key, { count: 1 })).toContain("1 anonymised accounting record");
    expect(i18n.t(key, { count: 3 })).toContain("3 anonymised accounting records");
  });
});
