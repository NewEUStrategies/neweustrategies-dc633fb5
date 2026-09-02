// Obecność online na ŚCIEŻCE SERWEROWEJ - `getServerSnapshot`.
//
// PO CO OSOBNY PLIK. `presence.ts` stoi na 95,2%, a jedyną niepokrytą funkcją
// jest `getServerSnapshot` - migawka dla `useSyncExternalStore` w renderze
// serwerowym. To NIE jest kosmetyczna luka: gdyby ta funkcja zwracała
// `getSnapshot()` (moduł jest singletonem, więc na serwerze trzymałby stan
// PIERWSZEGO żądania), render serwerowy pokazywałby zielone kropki obcych
// sesji, a hydratacja rozjeżdżałaby się z klientem. Reszta pliku (kanał,
// refcount, okres łaski) ma dowody w `presence.test.tsx` - tu jest wyłącznie
// ta jedna ścieżka, bo wymaga innego renderera.
//
// `renderToString` NIE uruchamia efektów, więc kanał realtime nie powstaje -
// i to też jest częścią kontraktu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CHAT_IDS, realtimeStub } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  realtime: null as unknown,
  showOnline: true,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: CHAT_IDS.me }, tenantId: CHAT_IDS.tenant }),
}));

vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotificationPreferences: () => ({ data: { show_online_status: h.showOnline } }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const realtime = fixtures.realtimeStub({
    [CHAT_IDS.peer]: [{ user_id: CHAT_IDS.peer }],
  });
  h.realtime = realtime;
  return {
    supabase: { channel: realtime.channel, removeChannel: realtime.removeChannel },
  };
});

import { useOnlineUsers } from "../presence";

type RealtimeStub = ReturnType<typeof realtimeStub>;
const realtime = () => h.realtime as RealtimeStub;

function OnlineProbe() {
  const online = useOnlineUsers();
  return <span data-online-count={online.size}>{[...online].join(",")}</span>;
}

beforeEach(() => {
  h.showOnline = true;
  realtime().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOnlineUsers na serwerze", () => {
  it("render serwerowy widzi PUSTY zbiór - nikt nie jest online przed hydratacją", () => {
    const html = renderToString(<OnlineProbe />);
    expect(html).toContain('data-online-count="0"');
    // Gdyby serwer oddawał migawkę klienta, w HTML-u wylądowałby identyfikator
    // osoby z cudzej sesji - to jest wyciek, którego ten dowód pilnuje.
    expect(html).not.toContain(CHAT_IDS.peer);
  });

  it("render serwerowy NIE otwiera kanału realtime (efekty nie biegną na serwerze)", () => {
    renderToString(<OnlineProbe />);
    expect(realtime().channels).toHaveLength(0);
  });

  it("dwa niezależne renderowania serwerowe dają identyczny, pusty wynik", () => {
    // Moduł presence jest SINGLETONEM w procesie. Gdyby migawka serwerowa
    // czytała stan modułu, drugie żądanie dziedziczyłoby stan pierwszego.
    const first = renderToString(<OnlineProbe />);
    const second = renderToString(<OnlineProbe />);
    expect(second).toBe(first);
  });
});
