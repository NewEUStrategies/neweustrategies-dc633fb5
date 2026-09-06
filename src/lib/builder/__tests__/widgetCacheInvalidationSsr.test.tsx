// @vitest-environment node
//
// ŚCIEŻKA SERWEROWA `widgetCacheInvalidation.tsx` - moduł ma na serwerze
// MILCZEĆ, a nie rzucać.
//
// PO CO OSOBNY PLIK. `WidgetLiveSync` jest montowany w `__root.tsx`, a
// `emitWidgetCacheInvalidate` woła warstwa mutacji buildera (`globalWidgets`,
// `popups`, `revisions`, edytor wpisów) - czyli kod, który bywa wciągany także
// w renderze serwerowym. Obie funkcje zaczynają się od sprawdzenia `typeof
// window`, a tej gałęzi NIE DA SIĘ wykonać pod happy-dom: podmiana `window` na
// `undefined` przed renderem wywraca sam react-dom (`resolveUpdatePriority`
// czyta `window.event`), a nie testowany moduł. Dlatego środowisko `node`
// i osobny plik - ta sama zasada, co w `src/lib/chat/__tests__/presenceSsr.test.tsx`.
//
// GRANICA DOWODU, KTÓREJ NIE UDAJĘ, ŻE NIE MA: `renderToString` NIE uruchamia
// efektów, więc strażnik `typeof window === "undefined"` WEWNĄTRZ efektu
// (widgetCacheInvalidation.tsx:38) pozostaje nieosiągalny z testu - na serwerze
// broni go już samo to, że efekt nigdy nie biegnie. Tutaj dowodzę tego, co
// osiągalne: render serwerowy nie otwiera kanału, nie rejestruje nasłuchu
// i nie wywraca się na braku `window`.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RealtimeStub } from "@/test/supabase";

const h = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { realtimeStub } = await import("@/test/supabase");
  const realtime = realtimeStub();
  h.realtime = realtime;
  return { supabase: { channel: realtime.channel, removeChannel: realtime.removeChannel } };
});

// Na serwerze redakcyjna sesja jest nierozstrzygnięta, ale nawet gdyby była
// rozstrzygnięta na `isStaff: true`, kanał NIE MOŻE powstać - dlatego atrapa
// zwraca tu wariant NAJBARDZIEJ uprawniony.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isStaff: true }) }));

import { WidgetLiveSync, emitWidgetCacheInvalidate } from "@/lib/builder/widgetCacheInvalidation";

const rt = () => h.realtime as RealtimeStub;

describe("widgetCacheInvalidation bez okna przeglądarki", () => {
  it("emitWidgetCacheInvalidate jest cichym no-opem, a nie wyjątkiem", () => {
    expect(typeof window).toBe("undefined");

    expect(() => emitWidgetCacheInvalidate()).not.toThrow();
    expect(emitWidgetCacheInvalidate()).toBeUndefined();
  });

  it("wielokrotne wywołanie na serwerze nadal nic nie robi", () => {
    // Warstwa mutacji buildera woła emiter po KAŻDYM zapisie; gdyby brak
    // `window` kończył się wyjątkiem, jeden zapis wywracałby cały render
    // serwerowy trasy administracyjnej.
    for (let i = 0; i < 3; i += 1) {
      expect(() => emitWidgetCacheInvalidate()).not.toThrow();
    }
  });

  it("render serwerowy WidgetLiveSync nie daje wyjścia i NIE otwiera kanału realtime", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const html = renderToString(
      <QueryClientProvider client={client}>
        <WidgetLiveSync />
      </QueryClientProvider>,
    );

    expect(html).toBe("");
    expect(rt().channels).toHaveLength(0);
    client.clear();
  });
});
