// Atom: pigulka typu zdarzenia w audycie.
import { EVENT_PILL_CLS, isKnownEventType } from "../model";

/** Nieznane typy zdarzen dostaja neutralna tonacje zamiast wysypywac render. */
export function EventPill({ type, label }: { type: string; label: string }) {
  const cls = isKnownEventType(type) ? EVENT_PILL_CLS[type] : EVENT_PILL_CLS.expired;
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}
