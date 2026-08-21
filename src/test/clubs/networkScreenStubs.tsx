// ATRAPY KOMPONENTÓW PODRZĘDNYCH ekranów sieciujących klubu.
//
// Każda wypisuje do DOM-u WYŁĄCZNIE to, co ekran jej podał - bo to jest
// przedmiot dowodu w testach organizmów. Prawdziwe komponenty mają własne pliki
// testowe, a tu wciągnęłyby swoje zapytania (`useConnectionStatuses`,
// `useClubMembers`) i zamieniłyby test ekranu w test trzech innych warstw.
//
// Fabryki, nie komponenty: `vi.mock` oczekuje OBIEKTU MODUŁU, więc każda
// zwraca gotowy kształt podmienianego modułu. Moduł importuje wyłącznie typy
// Reacta - fabryka `vi.mock`, która dosięgłaby `react-i18next`, zakleszcza
// kolekcję pliku testowego.
import type { ReactNode } from "react";

/** Fabryka atrapy `MessageOrConnectButton` dla fabryki `vi.mock`. */
export function messageOrConnectStub(): {
  MessageOrConnectButton: (props: {
    userId: string;
    displayName: string;
    compact?: boolean;
  }) => ReactNode;
} {
  return {
    MessageOrConnectButton: ({
      userId,
      displayName,
      compact,
    }: {
      userId: string;
      displayName: string;
      compact?: boolean;
    }) => (
      <button
        type="button"
        data-testid="kontakt"
        data-user-id={userId}
        data-display-name={displayName}
        data-compact={String(compact === true)}
      >
        kontakt
      </button>
    ),
  };
}

/** Fabryka atrapy `ClubPersonCard` - karta osoby ma własny plik testowy. */
export function personCardStub(): {
  ClubPersonCard: (props: {
    name: string;
    headline: string | null;
    profileSlug: string | null;
    role?: string | null;
    topics?: readonly string[];
    active?: boolean;
    meta?: ReactNode;
    actions?: ReactNode;
    className?: string;
  }) => ReactNode;
} {
  return {
    ClubPersonCard: ({
      name,
      headline,
      profileSlug,
      role,
      topics,
      active,
      meta,
      actions,
      className,
    }: {
      name: string;
      headline: string | null;
      profileSlug: string | null;
      role?: string | null;
      topics?: readonly string[];
      active?: boolean;
      meta?: ReactNode;
      actions?: ReactNode;
      className?: string;
    }) => (
      <article
        data-testid="karta-osoby"
        data-name={name}
        data-headline={headline ?? ""}
        data-slug={profileSlug ?? ""}
        data-role={role ?? ""}
        data-topics={(topics ?? []).join(",")}
        data-active={String(active === true)}
        data-class={className ?? ""}
        data-meta={meta === undefined ? "brak" : "jest"}
        data-actions={actions === undefined ? "brak" : "jest"}
      >
        <span>{name}</span>
        {meta}
        {actions}
      </article>
    ),
  };
}
