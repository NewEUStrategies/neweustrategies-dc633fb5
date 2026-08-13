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
      consent: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        "consent",
        "department",
        "email",
        "firstName",
        "lastName",
        "linkedin",
        "message",
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

  it("wymaga treści wiadomości zastępującej CV", () => {
    const short = validateApplication({ ...VALID, message: "Za krótko." });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.message).toBe("careers.form.errors.messageShort");
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
