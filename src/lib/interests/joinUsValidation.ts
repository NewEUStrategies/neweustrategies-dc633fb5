export interface JoinUsRequiredFieldConfig {
  showFirstName: boolean;
  showLastName: boolean;
  requireEmail: boolean;
  showPosition: boolean;
  showLinkedin: boolean;
  showPhone: boolean;
  showCompany: boolean;
  showCountry: boolean;
  requireFirstName: boolean;
  requireLastName: boolean;
  requirePosition: boolean;
  requireLinkedin: boolean;
  requirePhone: boolean;
  requireCompany: boolean;
  requireCountry: boolean;
}

export function requiredJoinUsFields(config: JoinUsRequiredFieldConfig): string[] {
  const required: Record<string, boolean> = {
    firstName: config.showFirstName && config.requireFirstName,
    lastName: config.showLastName && config.requireLastName,
    email: config.requireEmail,
    position: config.showPosition && config.requirePosition,
    linkedin: config.showLinkedin && config.requireLinkedin,
    phone: config.showPhone && config.requirePhone,
    company: config.showCompany && config.requireCompany,
    country: config.showCountry && config.requireCountry,
  };

  return Object.entries(required)
    .filter(([, enabled]) => enabled)
    .map(([field]) => field);
}

export type JoinUsValidationError =
  | { key: "joinUs.errorEmail" }
  | { key: "joinUs.requiredFields"; values: { fields: string } }
  | { key: "joinUs.interestsRequired" }
  | { key: "joinUs.consentRequired" };

export interface JoinUsValidationInput {
  email: string;
  requireEmail: boolean;
  values: Readonly<Record<string, string>>;
  requiredFields: readonly string[];
  showInterests: boolean;
  requireInterests: boolean;
  availableInterestCount: number;
  selectedInterestCount: number;
  missingCustomFields: readonly string[];
  consentAccepted: boolean;
}

export function validateJoinUsSubmission(
  input: JoinUsValidationInput,
): JoinUsValidationError | null {
  if (input.requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return { key: "joinUs.errorEmail" };
  }

  const missing = input.requiredFields.filter((field) => !input.values[field]);
  if (missing.length > 0) {
    return { key: "joinUs.requiredFields", values: { fields: missing.join(", ") } };
  }

  if (
    input.showInterests &&
    input.requireInterests &&
    input.availableInterestCount > 0 &&
    input.selectedInterestCount === 0
  ) {
    return { key: "joinUs.interestsRequired" };
  }

  if (input.missingCustomFields.length > 0) {
    return {
      key: "joinUs.requiredFields",
      values: { fields: input.missingCustomFields.join(", ") },
    };
  }

  return input.consentAccepted ? null : { key: "joinUs.consentRequired" };
}
