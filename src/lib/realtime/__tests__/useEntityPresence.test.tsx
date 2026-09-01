// Obecność per encja („kto teraz ogląda ten obiekt?"). To jest funkcja
// PRYWATNOŚCI, nie ozdobnik: topic kanału powstaje z tenanta, typu i id encji,
// a ładunek presence niesie imię i nazwisko osoby. Trzy defekty, których pilnują
// te testy, nie wywracają żadnego renderu:
//
//   * zgubione `private: true` - dotąd publiczny topic ujawniał nazwiska osób
//     edytujących każdemu, kto odgadł `presence:<tenant>:<typ>:<id>`;
//   * pominięty tenant albo typ encji w nazwie topicu - zderzenie identyfikatorów
//     miesza obecność między bytami i między klientami;
//   * brak wykluczenia SIEBIE z migawki - banner „ktoś tu jeszcze jest" zapala
//     się przy pracy w pojedynkę i przestaje cokolwiek znaczyć.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FakeChannel, RealtimeStub } from "@/test/supabase";

const TENANT = "22222222-2222-4222-a222-222222222222";
const ME = "11111111-1111-4111-a111-111111111111";
const PEER = "44444444-4444-4444-a444-444444444444";
const PEER_TWO = "55555555-5555-4555-a555-555555555555";
const POST_ID = "66666666-6666-4666-a666-666666666666";

interface AuthUserStub {
  id: string;
  email: string | null;
  /** Opcjonalne CELOWO - sesja odtworzona ze storage bywa bez metadanych. */
  user_metadata?: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  auth: {
    tenantId: "22222222-2222-4222-a222-222222222222" as string | null,
    user: {
      id: "11111111-1111-4111-a111-111111111111",
      email: "editor@example.com",
      user_metadata: { display_name: "Anna Kowalska" },
    } as AuthUserStub | null,
  },
  // Roster presence jest czytany przez getter, więc test może go podmienić
  // POMIĘDZY zdarzeniami sync bez przebudowy kanału.
  presence: { state: {} as Record<string, Array<Record<string, unknown>>> },
}));

const stubs = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const atoms = await import("@/test/supabase");
  const dynamicPresence = new Proxy<Record<string, Array<{ user_id: string }>>>(
    {},
    {
      get: (_target, key: string) => h.presence.state[key],
      ownKeys: () => Object.keys(h.presence.state),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );
  const realtime = atoms.realtimeStub(dynamicPresence);
  stubs.realtime = realtime;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.auth.user, tenantId: h.auth.tenantId }),
}));

import { useEntityPresence } from "@/lib/realtime/useEntityPresence";

const rt = () => stubs.realtime as RealtimeStub;

function liveChannel(): FakeChannel {
  const found = rt().liveChannels("presence:");
  expect(found).toHaveLength(1);
  return found[0];
}

/** Odpala handler `presence:sync` - atrapa nie ma dla niego skrótu. */
function emitSync(channel: FakeChannel = liveChannel()): void {
  act(() => {
    for (const listener of channel.listeners) {
      if (listener.type === "presence" && listener.filter.event === "sync") listener.handler({});
    }
  });
}

beforeEach(() => {
  h.auth.tenantId = TENANT;
  h.auth.user = {
    id: ME,
    email: "editor@example.com",
    user_metadata: { display_name: "Anna Kowalska" },
  };
  h.presence.state = {};
  rt().reset();
});

afterEach(() => {
  // Kanał presence trzyma websocket - zgubiony `removeChannel` wyczerpuje
  // kwotę połączeń po kilku przejściach między trasami.
  for (const channel of rt().channels) {
    expect(channel.removed, `kanał ${channel.name} nie został zwolniony`).toBe(true);
  }
});

describe("useEntityPresence - adresowanie i prywatność topicu", () => {
  it("buduje topic z tenanta, typu i id encji oraz zamyka go kluczem PRIVATE", () => {
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    const channel = liveChannel();
    expect(channel.name).toBe(`presence:${TENANT}:post:${POST_ID}`);
    // `private: true` włącza Realtime Authorization - bez tego roster jest
    // czytelny dla każdego, kto zna (albo zgadnie) nazwę topicu.
    expect(channel.config).toEqual({ config: { private: true, presence: { key: ME } } });

    unmount();
  });

  it("każdy typ encji ma WŁASNY topic przy tym samym identyfikatorze", () => {
    // Bez typu w nazwie wpis i strona o tym samym id dzieliłyby pokój
    // obecności, a banner pokazywałby edytorów innego dokumentu.
    const post = renderHook(() => useEntityPresence("post", POST_ID));
    const lead = renderHook(() => useEntityPresence("crm_lead", POST_ID));

    const names = rt()
      .liveChannels("presence:")
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(
      [`presence:${TENANT}:crm_lead:${POST_ID}`, `presence:${TENANT}:post:${POST_ID}`].sort(),
    );

    post.unmount();
    lead.unmount();
  });

  it("ogłasza własną obecność DOPIERO po statusie SUBSCRIBED", () => {
    const { unmount } = renderHook(() => useEntityPresence("page", POST_ID));

    const channel = liveChannel();
    const tracked = channel.sent.filter((payload) => payload.type === "presence");
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({ user_id: ME, name: "Anna Kowalska" });
    expect(typeof tracked[0].since).toBe("string");
    expect(Number.isNaN(Date.parse(String(tracked[0].since)))).toBe(false);

    unmount();
  });

  it("zmiana encji PRZEBUDOWUJE kanał i zwalnia poprzedni", () => {
    // Bez zwolnienia poprzedniego kanału edytor zostaje „obecny" na wpisie,
    // który już zamknął - kolejni widzą duchy.
    const holder = { entityId: POST_ID };
    const { rerender, unmount } = renderHook(() => useEntityPresence("post", holder.entityId));
    const before = liveChannel();

    holder.entityId = "77777777-7777-4777-a777-777777777777";
    act(() => rerender());

    expect(before.removed).toBe(true);
    expect(liveChannel().name).toBe(`presence:${TENANT}:post:77777777-7777-4777-a777-777777777777`);

    unmount();
  });
});

describe("useEntityPresence - migawka obecnych", () => {
  it("wyklucza SIEBIE z listy obecnych", () => {
    h.presence.state = {
      [ME]: [{ user_id: ME, name: "Anna Kowalska", since: "2026-09-01T09:00:00.000Z" }],
      [PEER]: [{ user_id: PEER, name: "Barbara Nowak", since: "2026-09-01T09:05:00.000Z" }],
    };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    emitSync();
    expect(result.current).toEqual([
      { userId: PEER, name: "Barbara Nowak", sinceIso: "2026-09-01T09:05:00.000Z" },
    ]);

    unmount();
  });

  it("porządkuje listę od NAJDŁUŻEJ obecnego", () => {
    // Kolejność jest informacją: pierwsza osoba na liście najpewniej pracuje
    // nad dokumentem od dawna, więc to jej pracę można nadpisać.
    h.presence.state = {
      [PEER]: [{ user_id: PEER, name: "Barbara", since: "2026-09-01T10:00:00.000Z" }],
      [PEER_TWO]: [{ user_id: PEER_TWO, name: "Cezary", since: "2026-09-01T08:00:00.000Z" }],
    };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    emitSync();
    expect(result.current.map((peer) => peer.name)).toEqual(["Cezary", "Barbara"]);

    unmount();
  });

  it("pomija klucze z pustą listą metadanych", () => {
    // Supabase zostawia w rosterze klucz bez metadanych na czas rozłączenia;
    // wpis bez metadanych stałby się „obecnym" bez nazwiska i bez czasu.
    h.presence.state = {
      [PEER]: [],
      [PEER_TWO]: [{ user_id: PEER_TWO, name: "Cezary", since: "2026-09-01T08:00:00.000Z" }],
    };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    emitSync();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].userId).toBe(PEER_TWO);

    unmount();
  });

  it("brakujące pola metadanych degradują się do klucza presence, znaku zapytania i czasu bieżącego", () => {
    h.presence.state = { [PEER]: [{}] };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    emitSync();
    expect(result.current[0].userId).toBe(PEER);
    expect(result.current[0].name).toBe("?");
    expect(Number.isNaN(Date.parse(result.current[0].sinceIso))).toBe(false);

    unmount();
  });

  it("pusta nazwa w metadanych zamienia się w znak zapytania, nie w pustą etykietę", () => {
    // Pusty string przeszedłby do bannera jako „ , " - lista przecinków bez
    // nazwisk jest gorsza niż brak bannera.
    h.presence.state = {
      [PEER]: [{ user_id: PEER, name: "", since: "2026-09-01T08:00:00.000Z" }],
    };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    emitSync();
    expect(result.current[0].name).toBe("?");

    unmount();
  });

  it("kolejny sync odświeża migawkę po odejściu osoby", () => {
    h.presence.state = {
      [PEER]: [{ user_id: PEER, name: "Barbara", since: "2026-09-01T08:00:00.000Z" }],
      [PEER_TWO]: [{ user_id: PEER_TWO, name: "Cezary", since: "2026-09-01T09:00:00.000Z" }],
    };
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    emitSync();
    expect(result.current).toHaveLength(2);

    h.presence.state = {
      [PEER]: [{ user_id: PEER, name: "Barbara", since: "2026-09-01T08:00:00.000Z" }],
    };
    emitSync();
    expect(result.current.map((peer) => peer.userId)).toEqual([PEER]);

    unmount();
  });
});

describe("useEntityPresence - nazwa wyświetlana", () => {
  const cases: Array<[string, Record<string, unknown>, string | null, string]> = [
    [
      "display_name ma pierwszeństwo",
      { display_name: "Anna K.", full_name: "Anna Kowalska" },
      "a@example.com",
      "Anna K.",
    ],
    [
      "full_name gdy brak display_name",
      { full_name: "Anna Kowalska" },
      "a@example.com",
      "Anna Kowalska",
    ],
    ["first_name jako trzeci wybór", { first_name: "Anna" }, "a@example.com", "Anna"],
    ["adres e-mail jako ostatnia deska ratunku", {}, "anna@example.org", "anna@example.org"],
    [
      "same białe znaki są traktowane jak brak",
      { display_name: "   " },
      "anna@example.org",
      "anna@example.org",
    ],
    [
      "wartość nie-tekstowa jest pomijana",
      { display_name: 42 },
      "anna@example.org",
      "anna@example.org",
    ],
    ["bez czegokolwiek zostaje znak zapytania", {}, null, "?"],
  ];

  it.each(cases)("%s", (_label, metadata, email, expected) => {
    // Nazwa jedzie w ładunku presence do WSZYSTKICH w pokoju, więc kolejność
    // źródeł jest decyzją o tym, co widzą inni - a nie kosmetyką.
    h.auth.user = { id: ME, email, user_metadata: metadata };
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    const tracked = liveChannel().sent.filter((payload) => payload.type === "presence");
    expect(tracked[0].name).toBe(expected);

    unmount();
  });

  it("sesja BEZ metadanych nie wywraca hooka i schodzi do adresu e-mail", () => {
    // `user_metadata` bywa nieobecne w sesji odtworzonej ze storage. Odczyt
    // pola z `undefined` rzuciłby w efekcie, czyli w miejscu, które wywraca
    // cały edytor - a jedyne, co jest tu do zrobienia, to sięgnąć po e-mail.
    h.auth.user = { id: ME, email: "anna@example.org" };
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));

    const tracked = liveChannel().sent.filter((payload) => payload.type === "presence");
    expect(tracked[0].name).toBe("anna@example.org");

    unmount();
  });

  it("przycina białe znaki wokół nazwy", () => {
    h.auth.user = { id: ME, email: null, user_metadata: { display_name: "  Anna Kowalska  " } };
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    const tracked = liveChannel().sent.filter((payload) => payload.type === "presence");
    expect(tracked[0].name).toBe("Anna Kowalska");
    unmount();
  });
});

describe("useEntityPresence - warunki, w których kanał nie może powstać", () => {
  it("bez id encji nie otwiera kanału i zwraca pustą listę", () => {
    // Nowy, niezapisany wpis nie ma id. Podstawienie pustego stringa dałoby
    // topic `presence:<tenant>:post:` wspólny dla WSZYSTKICH nowych wpisów.
    const nullId = renderHook(() => useEntityPresence("post", null));
    expect(nullId.result.current).toEqual([]);
    expect(rt().channels).toEqual([]);
    nullId.unmount();

    const undefinedId = renderHook(() => useEntityPresence("post", undefined));
    expect(rt().channels).toEqual([]);
    undefinedId.unmount();

    const emptyId = renderHook(() => useEntityPresence("post", ""));
    expect(rt().channels).toEqual([]);
    emptyId.unmount();
  });

  it("bez tenanta nie otwiera kanału", () => {
    // Topic bez tenanta byłby wspólny dla WSZYSTKICH instalacji na tym projekcie
    // Realtime - obecność wyciekłaby poza tenant.
    h.auth.tenantId = null;
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    expect(result.current).toEqual([]);
    expect(rt().channels).toEqual([]);
    unmount();
  });

  it("bez zalogowanego użytkownika nie otwiera kanału", () => {
    h.auth.user = null;
    const { result, unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    expect(result.current).toEqual([]);
    expect(rt().channels).toEqual([]);
    unmount();
  });

  it("status INNY niż SUBSCRIBED nie ogłasza obecności", () => {
    // Nieudana subskrypcja (CHANNEL_ERROR, TIMED_OUT) nie może kończyć się
    // wysłaniem `track` - ładunek presence z nazwiskiem poszedłby wtedy na
    // kanał, którego serwer nie autoryzował.
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    const channel = liveChannel();
    const before = channel.sent.filter((payload) => payload.type === "presence").length;
    expect(before).toBe(1);

    act(() => channel.emitStatus("CHANNEL_ERROR"));
    act(() => channel.emitStatus("TIMED_OUT"));
    act(() => channel.emitStatus("CLOSED"));

    expect(channel.sent.filter((payload) => payload.type === "presence")).toHaveLength(1);

    unmount();
  });

  it("ponowne SUBSCRIBED po zerwaniu połączenia ogłasza obecność jeszcze raz", () => {
    // Po reconnect serwer nie pamięta rosteru - bez ponownego `track`
    // użytkownik znika z listy obecnych mimo otwartego edytora.
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    const channel = liveChannel();

    act(() => channel.emitStatus("SUBSCRIBED"));

    expect(channel.sent.filter((payload) => payload.type === "presence")).toHaveLength(2);

    unmount();
  });

  it("odmontowanie zwalnia kanał", () => {
    const { unmount } = renderHook(() => useEntityPresence("post", POST_ID));
    const channel = liveChannel();
    expect(channel.removed).toBe(false);

    unmount();
    expect(channel.removed).toBe(true);
  });
});
