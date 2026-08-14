// Reguły walidacji zgłoszenia rekrutacyjnego - jedno źródło prawdy dla
// kreatora i dla payloadu trafiającego do Contact Center / CRM.
import { describe, expect, it } from "vitest";

import {
  CAREER_FIELD_STEP,
  MESSAGE_MIN,
  hasErrors,
  validateApplication,
  validateStep,
  type CareerApplicationInput,
} from "../applicationSchema";

const VALID: CareerApplicationInput = {
  firstName: "Jan",
  lastName: "Kowalski",
  email: "jan.kowalski@example.com",
  phone: "+48 600 100 200",
  linkedin: "linkedin.com/in/jan-kowalski",
  department: "analysis",
  role: "analyst_economy",
  seniority: "mid",
  start: "month",
  message: "x".repeat(MESSAGE_MIN),
  cvFileName: "cv.pdf",
  cvUrl: "",
  consent: true,
};

describe("careerApplicationSchema", () => {
  it("przepuszcza komplet danych i przycina białe znaki", () => {
    const result = validateApplication({ ...VALID, firstName: "  Jan  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.firstName).toBe("Jan");
  });

  it("wymaga wszystkich pól potrzebnych CRM", () => {
    const result = validateApplication({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      linkedin: "",
      department: "",
      role: "",
      seniority: "",
      start: "",
      message: "",
      cvFileName: "",
      cvUrl: "",
      consent: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        "consent",
        "cv",
        "department",
        "email",
        "firstName",
        "lastName",
        "phone",
        "role",
        "seniority",
        "start",
      ].sort(),
    );
    expect(result.firstStep).toBe(0);
    expect(result.firstField).toBe("firstName");
  });

  it("waliduje format e-maila, telefonu i linku", () => {
    const bad = validateApplication({
      ...VALID,
      email: "to-nie-email",
      phone: "123",
      linkedin: "nie link",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.email).toBe("careers.form.errors.emailInvalid");
    expect(bad.errors.phone).toBe("careers.form.errors.phoneInvalid");
    expect(bad.errors.linkedin).toBe("careers.form.errors.linkedinInvalid");
  });

  it("traktuje wiadomość i LinkedIn jako opcjonalne", () => {
    const result = validateApplication({ ...VALID, message: "", linkedin: "" });
    expect(result.ok).toBe(true);
  });

  it("wymaga CV: pliku albo linku", () => {
    const missing = validateApplication({ ...VALID, cvFileName: "", cvUrl: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.cv).toBe("careers.form.errors.cvRequired");
      expect(missing.firstStep).toBe(CAREER_FIELD_STEP.cv);
    }

    const link = validateApplication({
      ...VALID,
      cvFileName: "",
      cvUrl: "drive.google.com/file/abc",
    });
    expect(link.ok).toBe(true);

    const bad = validateApplication({ ...VALID, cvFileName: "", cvUrl: "nie link" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.cv).toBe("careers.form.errors.cvUrlInvalid");
  });

  it("wskazuje krok pierwszego błędu", () => {
    const result = validateApplication({ ...VALID, seniority: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstField).toBe("seniority");
      expect(result.firstStep).toBe(CAREER_FIELD_STEP.seniority);
    }
  });

  it("validateStep zwraca tylko błędy z danego kroku", () => {
    const step1 = validateStep(1, { ...VALID, firstName: "", department: "" });
    expect(hasErrors(step1)).toBe(true);
    expect(step1.department).toBe("careers.form.errors.departmentRequired");
    expect(step1.firstName).toBeUndefined();

    expect(hasErrors(validateStep(0, VALID))).toBe(false);
    expect(hasErrors(validateStep(2, VALID))).toBe(false);
  });
});
