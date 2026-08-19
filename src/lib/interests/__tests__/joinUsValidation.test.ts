import { describe, expect, it } from "vitest";
import {
  requiredJoinUsFields,
  validateJoinUsSubmission,
  type JoinUsValidationInput,
} from "@/lib/interests/joinUsValidation";

const baseRequiredConfig = {
  showFirstName: false,
  showLastName: false,
  requireEmail: true,
  showPosition: false,
  showLinkedin: false,
  showPhone: false,
  showCompany: false,
  showCountry: false,
  requireFirstName: false,
  requireLastName: false,
  requirePosition: false,
  requireLinkedin: false,
  requirePhone: false,
  requireCompany: false,
  requireCountry: false,
};

const validInput: JoinUsValidationInput = {
  email: "talent@example.test",
  requireEmail: true,
  values: { email: "talent@example.test" },
  requiredFields: ["email"],
  showInterests: true,
  requireInterests: false,
  availableInterestCount: 2,
  selectedInterestCount: 0,
  missingCustomFields: [],
  consentAccepted: true,
};

describe("requiredJoinUsFields", () => {
  it("uwzględnia tylko widoczne pola oznaczone jako wymagane", () => {
    const fields = requiredJoinUsFields({
      ...baseRequiredConfig,
      showFirstName: true,
      requireFirstName: true,
      requireLastName: true,
      showCountry: true,
      requireCountry: true,
    });

    expect(fields).toEqual(["firstName", "email", "country"]);
    expect(fields).not.toContain("lastName");
  });

  it("pozwala skonfigurować formularz bez pól wymaganych", () => {
    const fields = requiredJoinUsFields({ ...baseRequiredConfig, requireEmail: false });

    expect(fields).toHaveLength(0);
    expect(fields).toEqual([]);
  });
});

describe("validateJoinUsSubmission", () => {
  it("odrzuca niepoprawny wymagany adres e-mail jako pierwszy błąd", () => {
    const result = validateJoinUsSubmission({
      ...validInput,
      email: "niepoprawny",
      values: { email: "", firstName: "" },
      requiredFields: ["email", "firstName"],
    });

    expect(result).toEqual({ key: "joinUs.errorEmail" });
    expect(result && "values" in result).toBe(false);
  });

  it("pomija walidację formatu niewymaganego e-maila", () => {
    const result = validateJoinUsSubmission({
      ...validInput,
      email: "",
      requireEmail: false,
      values: {},
      requiredFields: [],
    });

    expect(result).toBeNull();
    expect(validInput.requireEmail).toBe(true);
  });

  it("zwraca deskryptor wszystkich brakujących pól standardowych", () => {
    const result = validateJoinUsSubmission({
      ...validInput,
      values: { email: "talent@example.test", firstName: "", country: "" },
      requiredFields: ["email", "firstName", "country"],
    });

    expect(result).toEqual({
      key: "joinUs.requiredFields",
      values: { fields: "firstName, country" },
    });
    expect(result?.key).toBe("joinUs.requiredFields");
  });

  it("wymaga zainteresowania tylko przy niepustym katalogu", () => {
    const missing = validateJoinUsSubmission({
      ...validInput,
      requireInterests: true,
    });
    const emptyCatalog = validateJoinUsSubmission({
      ...validInput,
      requireInterests: true,
      availableInterestCount: 0,
    });

    expect(missing).toEqual({ key: "joinUs.interestsRequired" });
    expect(emptyCatalog).toBeNull();
  });

  it("zwraca brakujące pola niestandardowe po regułach podstawowych", () => {
    const result = validateJoinUsSubmission({
      ...validInput,
      missingCustomFields: ["department", "seniority"],
    });

    expect(result).toEqual({
      key: "joinUs.requiredFields",
      values: { fields: "department, seniority" },
    });
    expect(result?.key).not.toBe("joinUs.consentRequired");
  });

  it("wymaga zgody po przejściu pozostałych reguł", () => {
    const result = validateJoinUsSubmission({ ...validInput, consentAccepted: false });

    expect(result).toEqual({ key: "joinUs.consentRequired" });
    expect(result?.key).toBe("joinUs.consentRequired");
  });

  it("przepuszcza kompletny formularz", () => {
    const result = validateJoinUsSubmission(validInput);

    expect(result).toBeNull();
    expect(validInput.selectedInterestCount).toBe(0);
  });
});
