// Safe parser for builder_data JSONB coming from the database.
// Never trust the shape — coerce to BuilderDocument or return an empty doc.
import type { BuilderDocument } from "./types";
import { emptyDocument } from "./types";

export function parseBuilderDoc(raw: unknown): BuilderDocument {
  if (!raw || typeof raw !== "object") return emptyDocument();
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.sections)) return emptyDocument();
  return { version: 1, sections: r.sections as BuilderDocument["sections"] };
}
