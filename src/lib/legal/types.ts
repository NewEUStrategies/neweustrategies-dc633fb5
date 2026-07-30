// Typy domeny dokumentów prawnych (regulamin, prywatność, zwroty) wraz z
// walidacją treści zapisywanej w bazie (legal_document_versions.content).
// Treść jest serializowalna: ikony trzymamy jako nazwy, nie komponenty.
import { z } from "zod";

export const LEGAL_DOC_KEYS = ["terms", "privacy", "refunds"] as const;
export type LegalDocKey = (typeof LEGAL_DOC_KEYS)[number];

export const LEGAL_VERSION_STATUSES = ["draft", "published", "archived"] as const;
export type LegalVersionStatus = (typeof LEGAL_VERSION_STATUSES)[number];

export interface LegalSectionData {
  id: string;
  icon: string;
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

export interface LegalDocCopy {
  eyebrow: string;
  title: string;
  lead: string;
  updated: string;
  footnote?: string;
  sections: readonly LegalSectionData[];
}

export interface LegalDocContent {
  pl: LegalDocCopy;
  en: LegalDocCopy;
}

export interface LegalDocumentVersion {
  id: string;
  doc_key: LegalDocKey;
  label: string;
  status: LegalVersionStatus;
  content: LegalDocContent;
  note: string | null;
  effective_from: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const sectionSchema = z.object({
  id: z.string().min(1),
  icon: z.string().min(1),
  heading: z.string().min(1),
  paragraphs: z.array(z.string()).optional(),
  bullets: z.array(z.string()).optional(),
});

const copySchema = z.object({
  eyebrow: z.string(),
  title: z.string().min(1),
  lead: z.string(),
  updated: z.string(),
  footnote: z.string().optional(),
  sections: z.array(sectionSchema).max(80),
});

export const legalDocContentSchema = z.object({ pl: copySchema, en: copySchema });

/** Bezpieczny parse treści z bazy - `null` gdy kształt jest nieznany. */
export function safeParseLegalContent(value: unknown): LegalDocContent | null {
  const parsed = legalDocContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
