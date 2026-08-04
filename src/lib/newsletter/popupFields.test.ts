import { describe, it, expect } from "vitest";
import {
  resolvePopupFields,
  popupFieldMap,
  popupFieldLabel,
  popupFieldPlaceholder,
  isPopupFieldLocked,
  POPUP_FIELD_KEYS,
} from "@/lib/newsletter/popupFields";

describe("popupFields", () => {
  it("zwraca komplet pól w stałej kolejności dla pustej konfiguracji", () => {
    const fields = resolvePopupFields(null);
    expect(fields.map((f) => f.key)).toEqual([...POPUP_FIELD_KEYS]);
    expect(fields.every((f) => f.label_pl && f.label_en)).toBe(true);
  });

  it("scala nadpisania z defaultami", () => {
    const fields = popupFieldMap([
      { key: "phone", enabled: false, required: true, label_pl: "Telefon", label_en: "Phone" },
    ]);
    expect(fields.phone.enabled).toBe(false);
    expect(fields.phone.label_pl).toBe("Telefon");
    expect(fields.company.enabled).toBe(true);
  });

  it("nie pozwala wyłączyć pola e-mail", () => {
    const fields = popupFieldMap([{ key: "email", enabled: false, required: false }]);
    expect(fields.email.enabled).toBe(true);
    expect(fields.email.required).toBe(true);
    expect(isPopupFieldLocked("email")).toBe(true);
  });

  it("ignoruje śmieciowe wpisy i puste etykiety", () => {
    const fields = popupFieldMap([null, 42, { key: "job", label_pl: "   " }]);
    expect(fields.job.label_pl).toBe("Stanowisko");
  });

  it("zwraca etykietę zgodną z językiem", () => {
    const [first] = resolvePopupFields(null);
    expect(popupFieldLabel(first, "pl")).toBe("Imię");
    expect(popupFieldLabel(first, "en")).toBe("First name");
  });
  it("każde pole ma domyślną podpowiedź w PL i EN", () => {
    // `newsletter_optin` to checkbox - etykieta jest jego całą treścią.
    const inputs = resolvePopupFields(null).filter((f) => f.key !== "newsletter_optin");
    for (const field of inputs) {
      expect(popupFieldPlaceholder(field, "pl").trim()).not.toBe("");
      expect(popupFieldPlaceholder(field, "en").trim()).not.toBe("");
    }
  });

  it("pusta podpowiedź zapisana w adminie wygrywa z defaultem", () => {
    const fields = popupFieldMap([{ key: "email", placeholder_pl: "", placeholder_en: "" }]);
    expect(popupFieldPlaceholder(fields.email, "pl")).toBe("");
  });
});
