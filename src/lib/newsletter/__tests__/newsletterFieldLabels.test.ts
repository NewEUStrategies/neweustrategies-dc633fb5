// Wszystkie widgety newslettera muszą mieć te same etykiety pól i tę samą
// dropliste tematów. Test pilnuje, że etykiety pochodzą z globalnej
// konfiguracji rejestracji (Admin → Popupy) i że override widgetu wygrywa.
import { describe, it, expect } from "vitest";
import { buildRegistrationFieldsApi } from "@/lib/auth/registrationFields";
import {
  NEWSLETTER_FIELD_FALLBACKS,
  topicLabel,
  topicsTriggerText,
} from "@/lib/newsletter/newsletterFieldLabels";
import { popupFieldDefaultLabels } from "@/lib/newsletter/popupFields";

// Kopia logiki hooka bez Reacta - jedno źródło reguł precedencji.
function label(
  raw: unknown,
  lang: "pl" | "en",
  key: "firstName" | "email" | "company",
  override?: string,
) {
  const api = buildRegistrationFieldsApi(raw, lang);
  const map = { firstName: "first_name", email: "email", company: "company" } as const;
  const trimmed = override?.trim() ?? "";
  const global = api.label(map[key], "").trim();
  const factory = [
    ...Object.values(NEWSLETTER_FIELD_FALLBACKS[key]),
    ...popupFieldDefaultLabels(map[key]),
  ].map((v) => v.toLowerCase());
  if (trimmed && !factory.includes(trimmed.toLowerCase())) return trimmed;
  return global || NEWSLETTER_FIELD_FALLBACKS[key][lang];
}

describe("newsletter: wspólne etykiety pól", () => {
  it("bierze etykietę z globalnej konfiguracji rejestracji", () => {
    const raw = [{ key: "email", label_pl: "Adres e-mail", label_en: "E-mail address" }];
    expect(label(raw, "pl", "email")).toBe("Adres e-mail");
    expect(label(raw, "en", "email")).toBe("E-mail address");
  });

  it("override widgetu ma pierwszeństwo, pusty override jest ignorowany", () => {
    expect(label(null, "pl", "company", "  Organizacja  ")).toBe("Organizacja");
    expect(label(null, "pl", "company", "   ")).not.toBe("");
  });

  it("override będący kopią fabrycznej etykiety ustępuje globalnej konfiguracji", () => {
    const raw = [{ key: "email", label_pl: "Adres e-mail", label_en: "E-mail address" }];
    expect(label(raw, "pl", "email", "Twój e-mail")).toBe("Adres e-mail");
  });

  it("ma sensowny fallback PL/EN", () => {
    expect(label(null, "pl", "firstName")).toBeTruthy();
    expect(label(null, "en", "firstName")).toBeTruthy();
  });
});

describe("newsletter: droplista tematów", () => {
  it("ma te same teksty w obu językach", () => {
    expect(topicLabel("placeholder", "pl")).toBe("Wybierz tematy…");
    expect(topicLabel("placeholder", "en")).toBe("Select topics…");
  });

  it("licznik wybranych", () => {
    expect(topicsTriggerText(0, "pl")).toBe("Wybierz tematy…");
    expect(topicsTriggerText(3, "pl")).toBe("Wybrano: 3");
    expect(topicsTriggerText(3, "en")).toBe("3 selected");
  });
});
