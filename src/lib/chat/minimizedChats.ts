// Lekki magazyn zminimalizowanych rozmów (bez zapytań do serwera).
// Trzymamy tylko identyfikator i nazwę zapamiętaną w chwili minimalizacji,
// żeby pasek doku mógł narysować "pigułki" bez dociągania profili.
// Zapis w sessionStorage - wraca po odświeżeniu, nie zostaje na zawsze.
import { useSyncExternalStore } from "react";

export interface MinimizedChat {
  id: string;
  name: string;
  /** Opcjonalny avatar rozmówcy - dla pigułki zamiast ikony czatu. */
  avatarUrl?: string | null;
}

/** Ile pigułek pokazujemy wprost - reszta trafia pod ikonę "+N". */
export const MINIMIZED_VISIBLE_LIMIT = 2;

const STORAGE_KEY = "nes.chat.minimized";

interface StoreState {
  minimized: MinimizedChat[];
  /** Rozmowa, którą skrzynka ma otworzyć po przywróceniu. */
  requested: string | null;
}

let state: StoreState = { minimized: [], requested: null };
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.minimized));
  } catch {
    // brak dostępu do sessionStorage nie może psuć czatu
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const items = parsed.filter(
      (item): item is MinimizedChat =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as MinimizedChat).id === "string" &&
        typeof (item as MinimizedChat).name === "string",
    );
    if (items.length > 0) state = { ...state, minimized: items };
  } catch {
    // uszkodzony wpis ignorujemy
  }
}

const setState = (next: StoreState): void => {
  state = next;
  persist();
  emit();
};

export const minimizedChatsStore = {
  subscribe(listener: () => void): () => void {
    hydrate();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): StoreState {
    hydrate();
    return state;
  },
  getServerSnapshot(): StoreState {
    return { minimized: [], requested: null };
  },
  minimize(chat: MinimizedChat): void {
    const without = state.minimized.filter((item) => item.id !== chat.id);
    setState({ minimized: [chat, ...without], requested: null });
  },
  /** Zdejmuje z paska i prosi skrzynkę o otwarcie tej rozmowy. */
  restore(id: string): void {
    setState({
      minimized: state.minimized.filter((item) => item.id !== id),
      requested: id,
    });
  },
  remove(id: string): void {
    setState({ ...state, minimized: state.minimized.filter((item) => item.id !== id) });
  },
  clearRequest(): void {
    if (state.requested === null) return;
    setState({ ...state, requested: null });
  },
  /** Wyłącznie do testów. */
  reset(): void {
    hydrated = true;
    setState({ minimized: [], requested: null });
  },
};

export function useMinimizedChats(): StoreState {
  return useSyncExternalStore(
    minimizedChatsStore.subscribe,
    minimizedChatsStore.getSnapshot,
    minimizedChatsStore.getServerSnapshot,
  );
}
