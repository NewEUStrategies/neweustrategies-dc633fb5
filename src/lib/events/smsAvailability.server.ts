// Dostępność SMS-ów uczestnika - jedno źródło prawdy dla panelu organizatora,
// karty przypomnień uczestnika i zadań w tle (`participantSmsEnabled`).
import { participantSmsEnabled } from "@/lib/events/participantNotify.server";

export interface ParticipantSmsAvailability {
  smsEnabled: boolean;
}

export function readParticipantSmsAvailability(): ParticipantSmsAvailability {
  return { smsEnabled: participantSmsEnabled() };
}
