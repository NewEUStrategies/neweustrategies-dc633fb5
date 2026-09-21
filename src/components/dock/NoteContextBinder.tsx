// Publikuje kontekst aktualnie oglądanego materiału dla notatnika w doku.
// Nic nie renderuje - dzięki temu można go wstawić w dowolny widok treści
// (artykuł, raport, wywiad, podcast, wydarzenie, strona).
import { useEffect } from "react";
import { clearNoteContext, setNoteContext, type NoteEntityType } from "@/lib/dock/noteContext";

export interface NoteContextBinderProps {
  entityType: NoteEntityType;
  entityId?: string | null;
  title: string;
  /** Adres materiału; domyślnie bieżąca ścieżka. */
  url?: string | null;
}

export function NoteContextBinder({ entityType, entityId, title, url }: NoteContextBinderProps) {
  useEffect(() => {
    if (!entityId) return;
    const href =
      url ??
      (typeof window === "undefined" ? null : window.location.pathname + window.location.search);
    setNoteContext({ entityType, entityId, title, url: href });
    return () => clearNoteContext(entityId);
  }, [entityType, entityId, title, url]);

  return null;
}
