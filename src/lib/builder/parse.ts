// Safe parser for builder_data JSONB coming from the database.
// Never trust the shape - coerce to BuilderDocument or return an empty doc.
//
// Delegates to `safeParseBuilderDoc`, which deeply normalizes the tree so the
// public renderer's structural invariants hold (every section/column exposes an
// array of children, every widget has a known type + object content, every
// column has a span object) and drops only irrecoverable nodes. The renderer
// additionally sanitizes every user string at render time.
import type { BuilderDocument } from "./types";
import { safeParseBuilderDoc } from "./schema";

export function parseBuilderDoc(raw: unknown): BuilderDocument {
  return safeParseBuilderDoc(raw);
}
