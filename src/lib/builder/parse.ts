// Safe parser for builder_data JSONB coming from the database.
// Never trust the shape - coerce to BuilderDocument or return an empty doc.
import type { BuilderDocument, SectionNode } from "./types";
import { emptyDocument } from "./types";

function isObject(x: unknown): x is { [k: string]: unknown } {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function parseBuilderDoc(raw: unknown): BuilderDocument {
  if (!isObject(raw)) return emptyDocument();
  if (raw.version !== 1 || !Array.isArray(raw.sections)) return emptyDocument();
  // Sections are trusted structurally (validated upstream by the editor); the
  // public renderer additionally sanitizes every user string at render time.
  return { version: 1, sections: raw.sections as SectionNode[] };
}
