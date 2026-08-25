// Atom: plakietka stanu sesji programu.
//
// STAN LICZY BAZA, NIE KOMPONENT. Dostajemy gotowe `access_state`, więc jedyną
// decyzją tutaj jest KOLOR - a ten niesie znaczenie: „jesteś zapisany" musi
// wyglądać inaczej niż „komplet", bo obie plakietki mówią o tym samym miejscu
// i tylko jedna z nich jest dobrą wiadomością.
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { agendaStateKey, type AgendaAccessState } from "@/lib/events/agendaSurface";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANT: Record<AgendaAccessState, BadgeVariant> = {
  open: "outline",
  signup_required: "secondary",
  signed_up: "default",
  waitlisted: "secondary",
  full: "outline",
  tier_required: "secondary",
  cancelled: "destructive",
};

export function SessionStateBadge({ state }: { state: AgendaAccessState }) {
  const { t } = useTranslation();
  return (
    <Badge variant={VARIANT[state]} className="whitespace-nowrap">
      {t(agendaStateKey(state))}
    </Badge>
  );
}
