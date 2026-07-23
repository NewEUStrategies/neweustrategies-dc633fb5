// Prosty event-bus otwierający globalny InMailDialog. Wywoływany z
// useStartConversation, gdy get_or_create_direct_conversation zwróci
// `chat: expert requires inmail`.
export interface InMailPrefill {
  recipientId: string;
  recipientName?: string | null;
  recipientAvatar?: string | null;
  subject?: string;
}

type Listener = (prefill: InMailPrefill | null) => void;
const listeners = new Set<Listener>();

export function openInMailDialog(prefill: InMailPrefill): void {
  for (const l of listeners) l(prefill);
}

export function closeInMailDialog(): void {
  for (const l of listeners) l(null);
}

export function subscribeInMailDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
