import { z } from "zod";

/** Transport ceilings shared by the public form and the server validator. */
export const CONTACT_FIELD_LIMITS = {
  name: 200,
  firstName: 100,
  lastName: 100,
  email: 320,
  phone: 40,
  company: 200,
  subject: 300,
  message: 8000,
  custom: 500,
} as const;

export const contactTextSchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_FIELD_LIMITS.name),
  email: z.string().trim().email().max(CONTACT_FIELD_LIMITS.email),
  subject: z.string().trim().max(CONTACT_FIELD_LIMITS.subject).optional(),
  message: z.string().trim().min(1).max(CONTACT_FIELD_LIMITS.message),
});