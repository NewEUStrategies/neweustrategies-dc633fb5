// Realtime edit presence: who else is editing this entity right now?
// Cienka nakładka na uogólnione useEntityPresence (lib/realtime) - zachowana
// dla zgodności wstecznej edytorów postów/stron; nowe powierzchnie (CRM,
// media, konwersacje) używają useEntityPresence bezpośrednio.
import { useEntityPresence, type EntityPresencePeer } from "@/lib/realtime/useEntityPresence";

export type PresencePeer = EntityPresencePeer;

/**
 * Track presence on `entityType:entityId` and return the OTHER editors
 * (self excluded), oldest first. Empty array while disconnected or alone.
 */
export function useEditPresence(
  entityType: "post" | "page",
  entityId: string | null | undefined,
): PresencePeer[] {
  return useEntityPresence(entityType, entityId);
}
