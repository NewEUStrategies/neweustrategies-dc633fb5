// Atom: PLAKIETKA STANU ZGŁOSZENIA w panelu „Moje" (D0-5).
//
// DEFEKT, KTÓRY TEN PLIK ZAMYKA. Poprzednia plakietka uznawała za aktywne
// statusy `confirmed` / `registered` / `paid` - a `event_registrations.status`
// takich wartości NIE MA. Zgłoszenie zaakceptowane (`approved`) i obecność
// odnotowana na bramce (`attended`) pokazywały więc „oczekujące".
//
// JAWNA MAPA, NIE SKLEJANIE KLUCZY. Każdy status ma w `REGISTRATION_STATUS_TONE`
// (`lib/events/participantSurface.ts`) swój ton, a ton ma pełny literał klucza;
// wariant plakietki (bez klas CSS) mapuje ten plik. Status spoza mapy nie
// rysuje NICZEGO: plakietka, która obiecuje stan na podstawie wartości, której
// nie znamy, jest gorsza niż jej brak. Brak zgłoszenia (`null`) to też brak
// plakietki - ktoś, kto się nie zapisał, niczego nie oczekuje.
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  REGISTRATION_STATUS_TONE_LABEL_KEYS,
  registrationStatusTone,
  type RegistrationStatusTone,
} from "@/lib/events/participantSurface";
import { ensureI18n as ensureEventParticipantI18n } from "@/lib/i18n-event-participant";

const TONE_VARIANT: Record<RegistrationStatusTone, "default" | "secondary" | "outline"> = {
  active: "default",
  pending: "secondary",
  waitlist: "secondary",
  closed: "outline",
};

export function RegistrationStatusBadge({ status }: { status: string | null }) {
  ensureEventParticipantI18n();
  const { t } = useTranslation();
  const tone = status === null ? null : registrationStatusTone(status);
  if (tone === null) return null;
  return <Badge variant={TONE_VARIANT[tone]}>{t(REGISTRATION_STATUS_TONE_LABEL_KEYS[tone])}</Badge>;
}
