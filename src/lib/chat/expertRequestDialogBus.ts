// Prosty event-bus otwierający globalny ExpertRequestDialog. Wywoływany z
// useStartConversation, gdy get_or_create_direct_conversation zwróci
// `chat: expert requires request`, a także wprost z profilu eksperta.
export interface ExpertRequestPrefill {
  recipientId: string;
  recipientName?: string | null;
  recipientAvatar?: string | null;
  subject?: string;
}

type Listener = (prefill: ExpertRequestPrefill | null) => void;
const listeners = new Set<Listener>();

export function openExpertRequestDialog(prefill: ExpertRequestPrefill): void {
  for (const l of listeners) l(prefill);
}

export function closeExpertRequestDialog(): void {
  for (const l of listeners) l(null);
}

export function subscribeExpertRequestDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
