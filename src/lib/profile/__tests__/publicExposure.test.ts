// Model ekspozycji publicznej profilu - czysta warstwa.
//
// Sedno kontraktu: normalizacja jest ZACHOWAWCZA w jedną stronę (brak wiersza
// albo `null` => `false`), bo z tego modelu bierze się zdanie, które platforma
// mówi użytkownikowi o jego prywatności. Fałszywe „jesteś prywatny" jest
// dokładnie tym błędem, który zamyka migracja 20260806160000 - test pilnuje,
// żeby nie wrócił od strony klienta.
import { describe, it, expect } from "vitest";
import {
  EXPOSURE_NONE,
  exposureReasons,
  normalizeExposure,
  type ExposureReason,
  type PublicExposure,
} from "@/lib/profile/publicExposure";

const ALL_REASONS: readonly ExposureReason[] = [
  "editorialRole",
  "expertBadge",
  "authorProfile",
  "speakerProfile",
  "publishedContent",
];

describe("normalizeExposure", () => {
  it("brak wiersza => nic nie jest publiczne", () => {
    expect(normalizeExposure(null)).toEqual(EXPOSURE_NONE);
    expect(normalizeExposure(undefined)).toEqual(EXPOSURE_NONE);
  });

  it("NULL z bazy nie awansuje na true (trójwartościowa logika SQL)", () => {
    const exposure = normalizeExposure({
      is_public: null,
      discoverable: null,
      by_editorial_role: null,
      by_expert_badge: null,
      by_author_profile: null,
      by_speaker_profile: null,
      by_published_content: null,
    });
    expect(exposure).toEqual(EXPOSURE_NONE);
  });

  it("mapuje snake_case bazy na model widoku bez gubienia flag", () => {
    const exposure = normalizeExposure({
      is_public: true,
      discoverable: false,
      by_editorial_role: false,
      by_expert_badge: true,
      by_author_profile: false,
      by_speaker_profile: true,
      by_published_content: true,
    });
    expect(exposure).toEqual({
      isPublic: true,
      discoverable: false,
      byEditorialRole: false,
      byExpertBadge: true,
      byAuthorProfile: false,
      bySpeakerProfile: true,
      byPublishedContent: true,
    });
  });

  it("discoverable jest NIEZALEŻNY od ekspozycji publicznej (opt-in wewnętrzny)", () => {
    // Opt-in do katalogu wewnętrznego nie otwiera warstwy publicznej - to
    // rozróżnienie, którego brakowało w dawnym copy panelu prywatności.
    const exposure = normalizeExposure({ is_public: false, discoverable: true });
    expect(exposure.discoverable).toBe(true);
    expect(exposure.isPublic).toBe(false);
  });
});

describe("exposureReasons", () => {
  it("profil bez sygnałów nie ma powodów", () => {
    expect(exposureReasons(EXPOSURE_NONE)).toEqual([]);
  });

  it("zwraca powody w stabilnej kolejności niezależnie od kolejności flag", () => {
    const exposure: PublicExposure = {
      ...EXPOSURE_NONE,
      isPublic: true,
      byPublishedContent: true,
      byExpertBadge: true,
      byEditorialRole: true,
    };
    expect(exposureReasons(exposure)).toEqual(["editorialRole", "expertBadge", "publishedContent"]);
  });

  it("każda flaga ma swój powód - brak martwych sygnałów w modelu", () => {
    for (const reason of ALL_REASONS) {
      const flagged: PublicExposure = { ...EXPOSURE_NONE, isPublic: true };
      const key = (
        {
          editorialRole: "byEditorialRole",
          expertBadge: "byExpertBadge",
          authorProfile: "byAuthorProfile",
          speakerProfile: "bySpeakerProfile",
          publishedContent: "byPublishedContent",
        } as const
      )[reason];
      flagged[key] = true;
      expect(exposureReasons(flagged)).toEqual([reason]);
    }
  });
});
