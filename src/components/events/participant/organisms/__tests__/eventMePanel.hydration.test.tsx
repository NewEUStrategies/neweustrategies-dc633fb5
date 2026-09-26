// PANEL „MOJE" - HTML SERWERA, PAMIĘĆ PODRĘCZNA DOKUMENTU I HYDRATACJA.
//
// PRZEDMIOT DOWODU (spec B.13, R-UI/SSR, MIN-2):
//
//  1. SERWER RYSUJE WYŁĄCZNIE SZKIELET. `AuthProvider` na serwerze nie ma sesji
//     (`loading === true`), więc panel nie może wypisać ani zakładek, ani
//     danych osobowych - dokument z pamięci podręcznej brzegowej trafia do
//     KAŻDEGO widza.
//  2. HTML NIE ZALEŻY OD `?tab=`. Reguła pamięci podręcznej dokumentu pomija
//     `tab` w kluczu trasy `/(en/)?events/<slug>/me` (`documentCache.ts`).
//     To jest bezpieczne wyłącznie wtedy, gdy serwerowy HTML dla `?tab=profile`,
//     `?tab=schedule` i `?tab=follow-up` jest bajt w bajt TEN SAM - i to
//     dokładnie mierzy drugi przypadek.
//  3. HYDRATACJA BEZ BŁĘDÓW. Klient montuje prawdziwy `AuthProvider` z SESJĄ
//     ZAPISANĄ w magazynie (jak zalogowany uczestnik wracający z e-maila):
//     pierwszy render klienta też jest szkieletem (sesja rozstrzyga się
//     w efekcie), więc React nie zgłasza niezgodności, a panel pojawia się
//     dopiero po rozstrzygnięciu sesji.
//
// Panel nie formatuje dat sam (godziny sesji rysuje gniazdo harmonogramu - ma
// własny test hydratacji `myAgendaList.hydration.test.tsx`), więc strefa
// serwera i klienta nie ma tu czego zmienić; mierzymy tożsamość i zakładkę.
// Organizmy potomne stoją na atrapach - mają własne pliki testowe.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

import type { EventMeTab } from "@/lib/events/eventMeTabs";
import type { MyEventPanelState } from "@/lib/events/myEventProfileApi";
import { eventParticipantPl } from "@/lib/i18n-event-participant";
import { makeEventParticipantOptions } from "@/test/events/participantFixtures";

const h = vi.hoisted(() => ({
  getSession: null as null | (() => Promise<{ data: { session: unknown } }>),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => (h.getSession === null ? new Promise(() => {}) : h.getSession()),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: (table: string) =>
      table === "user_roles"
        ? { select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }
        : {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
            }),
          },
  },
}));

vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => false,
  mergeAnonPersonalization: async () => {},
}));
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => ({}),
  },
  resolveSetting: (_map: unknown, _key: string, defaults: object) => defaults,
}));
vi.mock("@/lib/platform-error-reporting", () => ({ reportPlatformError: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/profile/useViewerCard", () => ({ useViewerCardFacts: () => null }));
vi.mock("@/lib/network/useConnections", () => ({
  useMyConnections: () => ({ data: { pages: [[]] }, isLoading: false }),
}));
vi.mock("@/components/events/participant/molecules/MyEventProfileForm", () => ({
  MyEventProfileForm: () => <div data-testid="formularz-kartoteki" />,
}));
vi.mock("@/components/events/participant/molecules/MyEventPublicPreview", () => ({
  MyEventPublicPreview: () => null,
}));
vi.mock("@/components/events/meetings/MeetingExchangeBoard", () => ({
  MeetingExchangeBoard: () => null,
}));
vi.mock("@/components/profile/ParticipantTicketsPanel", () => ({
  ParticipantTicketsPanel: () => null,
}));
vi.mock("@/components/events/participant/slots/EventMeScheduleSlot", () => ({
  EventMeScheduleSlot: () => <div data-testid="gniazdo-harmonogram" />,
}));
vi.mock("@/components/events/participant/slots/EventMeFollowUpSlot", () => ({
  EventMeFollowUpSlot: () => <div data-testid="gniazdo-po-wydarzeniu" />,
}));

const PROFIL: MyEventPanelState = {
  profile: null,
  account: null,
  registration: {
    registrationId: "22222222-2222-4222-8222-222222222222",
    status: "approved",
    paymentStatus: "paid",
    directoryOptOut: false,
    notifyEmail: true,
    notifySms: false,
    groups: [],
  },
};

vi.mock("@/lib/events/myEventProfileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/myEventProfileApi")>()),
  fetchMyEventProfile: async () => PROFIL,
}));
vi.mock("@/lib/events/participantOptionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/participantOptionsApi")>()),
  fetchEventParticipantOptions: async () => makeEventParticipantOptions({ surveyEnabled: true }),
}));

const { AuthProvider } = await import("@/hooks/useAuth");
const { EventMePanel } = await import("@/components/events/participant/organisms/EventMePanel");

/** Klucz, pod którym klient Supabase trzyma sesję dla `placeholder.supabase.co`. */
const STORED_SESSION_KEY = "sb-placeholder-auth-token";
const SLUG = "kongres-cee-2026";
const LOADING = eventParticipantPl.eventParticipant.loading;

function tree(tab: EventMeTab | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <EventMePanel slug={SLUG} tab={tab} onTabChange={() => {}} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.getSession = null;
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("EventMePanel - HTML serwera", () => {
  it("serwer rysuje wyłącznie szkielet: bez zakładek, bez danych i bez zaproszenia do logowania", () => {
    const html = renderToString(tree("schedule"));

    expect(html).toContain(LOADING);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("gniazdo-harmonogram");
    expect(html).not.toContain(PROFIL.registration?.registrationId ?? "brak");
  });

  it("HTML jest TEN SAM dla każdej zakładki z adresu - `tab` może wypaść z klucza pamięci dokumentu", () => {
    const tabs: (EventMeTab | undefined)[] = [
      undefined,
      "profile",
      "schedule",
      "contacts",
      "networking",
      "registration",
      "follow-up",
    ];
    const html = tabs.map((tab) => renderToString(tree(tab)));

    expect(new Set(html).size).toBe(1);
  });
});

describe("EventMePanel - hydratacja z sesją zapisaną w magazynie", () => {
  it("zero niezgodności hydratacji, a panel pojawia się po rozstrzygnięciu sesji", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(tree("follow-up"));
    document.body.append(host);

    window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "x" }));
    let resolveSession: (value: { data: { session: unknown } }) => void = () => {};
    h.getSession = () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      });

    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, tree("follow-up"), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    try {
      // Sesja jeszcze nie wróciła: klient nadal pokazuje ten sam szkielet.
      expect(errors).toEqual([]);
      expect(host.textContent).toContain(LOADING);

      await act(async () => {
        resolveSession({ data: { session: { user: { id: "u-1" } } } });
      });

      await waitFor(() => expect(screen.getByTestId("gniazdo-po-wydarzeniu")).toBeTruthy());
      expect(host.textContent).not.toContain(LOADING);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mój panel wydarzenia");
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
