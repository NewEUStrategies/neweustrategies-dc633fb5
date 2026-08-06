// Nota ekspozycji publicznej profilu.
//
// Test używa PRAWDZIWEJ instancji i18n (nie mocka `t`): jego wartością jest
// dowód, że komunikat istnieje w OBU językach i że NIE wraca dawna, nieprawdziwa
// obietnica „nigdy nie jesteś widoczny poza platformą". Z mockiem zwracającym
// klucz literówka przeszłaby niezauważona, a użytkownik zobaczyłby w panelu
// prywatności surowy identyfikator zamiast informacji o swojej ekspozycji.
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-chat";
import { PublicExposureNotice } from "@/components/molecules/PublicExposureNotice";
import { EXPOSURE_NONE, type PublicExposure } from "@/lib/profile/publicExposure";

const PUBLIC_BY_BADGE: PublicExposure = {
  ...EXPOSURE_NONE,
  isPublic: true,
  byExpertBadge: true,
  byPublishedContent: true,
};

/** Klucze, które nigdy nie mogą wyciec na ekran jako surowy identyfikator. */
const KEYS = [
  "profilePrivacy.exposurePrivateTitle",
  "profilePrivacy.exposurePrivateBody",
  "profilePrivacy.exposurePublicTitle",
  "profilePrivacy.exposurePublicBody",
  "profilePrivacy.exposureUnknownTitle",
  "profilePrivacy.exposureUnknownBody",
  "profilePrivacy.exposureLoading",
  "profilePrivacy.exposureReason.expertBadge",
  "profilePrivacy.exposureReason.publishedContent",
] as const;

function expectNoRawKeys(text: string | null): void {
  for (const key of KEYS) expect(text ?? "").not.toContain(key);
}

beforeAll(() => {
  ensureI18n();
});

afterEach(() => {
  cleanup();
});

describe("PublicExposureNotice", () => {
  it("profil bez publicznej obecności: stan `private` i konkretne zapewnienie", async () => {
    await i18n.changeLanguage("pl");
    render(<PublicExposureNotice exposure={EXPOSURE_NONE} />);

    const notice = screen.getByTestId("public-exposure-notice");
    expect(notice.dataset["state"]).toBe("private");
    expect(notice.textContent).toContain("niedostępny");
    // Bez powodów - nie ma czego wypisywać.
    expect(screen.queryByTestId("public-exposure-reasons")).toBeNull();
    expectNoRawKeys(notice.textContent);
  });

  it("profil publiczny: stan `public` i WYMIENIONE powody zamiast ogólnika", async () => {
    await i18n.changeLanguage("pl");
    render(<PublicExposureNotice exposure={PUBLIC_BY_BADGE} />);

    const notice = screen.getByTestId("public-exposure-notice");
    expect(notice.dataset["state"]).toBe("public");
    const reasons = screen.getByTestId("public-exposure-reasons");
    expect(reasons.querySelectorAll("li")).toHaveLength(2);
    expect(reasons.textContent).toContain("Odznaka eksperta");
    expect(reasons.textContent).toContain("Opublikowane materiały");
    expectNoRawKeys(notice.textContent);
  });

  it("po angielsku niesie ten sam kontrakt (parytet PL/EN)", async () => {
    await i18n.changeLanguage("en");
    render(<PublicExposureNotice exposure={PUBLIC_BY_BADGE} />);

    const notice = screen.getByTestId("public-exposure-notice");
    expect(notice.dataset["state"]).toBe("public");
    expect(notice.textContent).toContain("publicly reachable");
    expect(screen.getByTestId("public-exposure-reasons").textContent).toContain("Expert badge");
    expectNoRawKeys(notice.textContent);
  });

  it("brak odpowiedzi bazy => nota NEUTRALNA, nigdy fałszywe „jesteś prywatny”", async () => {
    await i18n.changeLanguage("pl");
    render(<PublicExposureNotice exposure={null} />);

    const notice = screen.getByTestId("public-exposure-notice");
    expect(notice.dataset["state"]).toBe("unknown");
    expect(notice.textContent).not.toContain("niedostępny");
    expectNoRawKeys(notice.textContent);
  });

  it("w trakcie odczytu pokazuje zapowiedź, a nie stan domyślny", async () => {
    await i18n.changeLanguage("pl");
    render(<PublicExposureNotice exposure={null} loading />);

    expect(screen.queryByTestId("public-exposure-notice")).toBeNull();
    const loading = screen.getByTestId("public-exposure-notice-loading");
    expect(loading.textContent).toBeTruthy();
    expectNoRawKeys(loading.textContent);
  });

  it("dawna, nieprawdziwa obietnica zniknęła z obu wersji językowych", async () => {
    // Regresja, którą ten test zamyka: `profilePrivacy.externalNote` twierdził
    // „nigdy nie jest widoczny (...) poza platformą" mimo publicznego widoku
    // profiles_public i mimo publicznych hubów /author/$slug.
    await i18n.changeLanguage("pl");
    expect(i18n.t("profilePrivacy.externalNote")).not.toContain("nigdy");
    expect(i18n.t("profilePrivacy.externalNote")).toContain("WEWNĘTRZNEJ");

    await i18n.changeLanguage("en");
    expect(i18n.t("profilePrivacy.externalNote")).not.toContain("never");
    expect(i18n.t("profilePrivacy.externalNote")).toContain("INTERNAL");
  });
});
