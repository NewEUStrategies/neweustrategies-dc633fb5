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

// Host dialogu jest React.lazy (__root) - klik w CTA może paść, zanim jego
// chunk się pobierze i zasubskrybuje. Bez replay emisja do pustego zbioru
// listenerów przepadałaby bezpowrotnie razem z prefillem; zapamiętujemy więc
// OSTATNIE żądanie i odtwarzamy je pierwszemu subskrybentowi.
let pendingPrefill: ExpertRequestPrefill | null = null;

export function openExpertRequestDialog(prefill: ExpertRequestPrefill): void {
  if (listeners.size === 0) {
    pendingPrefill = prefill;
    return;
  }
  for (const l of listeners) l(prefill);
}

export function closeExpertRequestDialog(): void {
  pendingPrefill = null;
  for (const l of listeners) l(null);
}

export function subscribeExpertRequestDialog(listener: Listener): () => void {
  listeners.add(listener);
  if (pendingPrefill !== null) {
    const prefill = pendingPrefill;
    pendingPrefill = null;
    listener(prefill);
  }
  return () => listeners.delete(listener);
}
