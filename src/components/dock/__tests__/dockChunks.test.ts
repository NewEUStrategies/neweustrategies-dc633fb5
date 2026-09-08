// ROZGRZEWANIE PACZEK - kontrakt modułów-właścicieli chunków.
//
// PO CO TESTOWAĆ COŚ, CO „TYLKO WOŁA IMPORT". Bo trzy własności tych funkcji
// są niewidoczne w kodzie i każda z nich, gdy zniknie, robi realną szkodę:
//
//   1. KOMPLETNOŚĆ MAPY. `prefetchDockPanel` bierze `DockToolId`. Dopisanie
//      narzędzia do `DOCK_TOOLS` bez podania jego paczki dałoby ciche
//      `undefined()` w obsłudze zdarzenia wskaźnika - czyli wyjątek przy
//      najechaniu kursorem na nową zakładkę.
//   2. POŁKNIĘTE ODRZUCENIE. Brak sieci NIE MOŻE wywalić obsługi
//      `pointerenter`. Bez `.catch()` byłoby to nieobsłużone odrzucenie
//      obietnicy przy każdym najechaniu w trybie offline.
//   3. ZWROT `void`. Funkcja jest wołana z procedury obsługi zdarzenia,
//      więc nie wolno jej oddawać obietnicy, na którą nikt nie czeka - to
//      ten sam powód, dla którego `checkoutDialogChunk` robi `void ...`.
import { describe, expect, it, vi } from "vitest";
import { DOCK_TOOLS } from "@/lib/dock/types";

describe("prefetchDockPanel - mapa narzędzie -> paczka", () => {
  it("KAŻDE narzędzie z DOCK_TOOLS ma swoją paczkę i nie rzuca", async () => {
    // Kompletność mapy pilnuje typ (`Record<DockToolId, ...>`), więc tu
    // sprawdzamy rzecz, której typ NIE sprawdzi: że wywołanie dla każdego
    // narzędzia faktycznie przechodzi. Brak wpisu dałby ciche
    // `undefined()`, czyli wyjątek w obsłudze `pointerenter`.
    const { prefetchDockPanel } = await import("../panelChunks");
    for (const tool of DOCK_TOOLS) {
      expect(() => prefetchDockPanel(tool), tool).not.toThrow();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("eksportuje PIĘĆ funkcji ładowania - `readLater` dzieli paczkę z zapisanymi", async () => {
    const mod = await import("../panelChunks");
    const loaders = Object.entries(mod).filter(([name]) => name.startsWith("load"));
    expect(loaders.map(([name]) => name).sort()).toEqual([
      "loadCalendarPanel",
      "loadChatSideDrawer",
      "loadNotesPanel",
      "loadSavedPanel",
      "loadTodoPanel",
    ]);
    for (const [name, loader] of loaders) {
      expect(typeof loader, name).toBe("function");
    }
  });

  it("każda funkcja ładowania zwraca kształt oczekiwany przez `React.lazy`", async () => {
    const mod = await import("../panelChunks");
    const loaded = await Promise.all([
      mod.loadTodoPanel(),
      mod.loadNotesPanel(),
      mod.loadSavedPanel(),
      mod.loadCalendarPanel(),
      mod.loadChatSideDrawer(),
    ]);
    // `React.lazy` wymaga `{ default: Component }` - literówka w nazwie
    // eksportu dałaby `default: undefined` i błąd dopiero przy OTWARCIU
    // panelu, w przeglądarce użytkownika.
    for (const chunk of loaded) {
      expect(typeof chunk.default).toBe("function");
    }
  });

  it("NIE zwraca obietnicy - jest wołana z procedury obsługi zdarzenia", async () => {
    const { prefetchDockPanel } = await import("../panelChunks");
    expect(prefetchDockPanel("todos")).toBeUndefined();
  });
});

describe("chatWindowChunk - właściciel paczki okna rozmowy", () => {
  // TA SAMA UMOWA, CO `panelChunks`, ale osobny moduł - i osobny powód.
  // `ChatSideDrawer` importował `ChatWindow` i `GroupCreateDialog` STATYCZNIE,
  // więc otwarcie samej LISTY wątków ciągnęło pełne okno wiadomości
  // (zmierzone: 80 plików / 592,7 kB źródła -> 17 plików / 141,5 kB).
  // Powrót statycznego importu jest niewidoczny w kodzie skrzynki, dlatego
  // granica ma własny test - a nie tylko komentarz.
  it("eksportuje DWIE funkcje ładowania i dwa rozgrzewania", async () => {
    const mod = await import("@/components/chat/chatWindowChunk");
    expect(
      Object.keys(mod)
        .filter((name) => name.startsWith("load") || name.startsWith("prefetch"))
        .sort(),
    ).toEqual([
      "loadChatWindow",
      "loadGroupCreateDialog",
      "prefetchChatWindow",
      "prefetchGroupCreateDialog",
    ]);
  });

  it("obie funkcje ładowania dają kształt wymagany przez `React.lazy`", async () => {
    const mod = await import("@/components/chat/chatWindowChunk");
    const loaded = await Promise.all([mod.loadChatWindow(), mod.loadGroupCreateDialog()]);
    // Literówka w nazwie eksportu dałaby `default: undefined` i błąd dopiero
    // przy WYBRANIU rozmowy, u użytkownika - nie tutaj.
    for (const chunk of loaded) {
      expect(typeof chunk.default).toBe("function");
    }
  });

  it("oba rozgrzewania zwracają `void` - są wołane z procedury obsługi zdarzenia", async () => {
    const mod = await import("@/components/chat/chatWindowChunk");
    expect(mod.prefetchChatWindow()).toBeUndefined();
    expect(mod.prefetchGroupCreateDialog()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("połknięte odrzucenie - offline nie wywala obsługi zdarzenia", () => {
  it("prefetchDockPanel nie zostawia nieobsłużonego odrzucenia", async () => {
    vi.resetModules();
    vi.doMock("../organisms/TodoPanel", () => Promise.reject(new Error("brak sieci")));

    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    globalThis.addEventListener?.("unhandledrejection", onRejection);

    const { prefetchDockPanel } = await import("../panelChunks");
    expect(() => prefetchDockPanel("todos")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    globalThis.removeEventListener?.("unhandledrejection", onRejection);
    expect(rejections).toEqual([]);

    vi.doUnmock("../organisms/TodoPanel");
    vi.resetModules();
  });

  it("prefetchChatWindow nie zostawia nieobsłużonego odrzucenia", async () => {
    vi.resetModules();
    vi.doMock("@/components/chat/ChatWindow", () => Promise.reject(new Error("brak sieci")));

    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    globalThis.addEventListener?.("unhandledrejection", onRejection);

    const { prefetchChatWindow } = await import("@/components/chat/chatWindowChunk");
    expect(() => prefetchChatWindow()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    globalThis.removeEventListener?.("unhandledrejection", onRejection);
    expect(rejections).toEqual([]);

    vi.doUnmock("@/components/chat/ChatWindow");
    vi.resetModules();
  });

  it("prefetchGroupCreateDialog nie zostawia nieobsłużonego odrzucenia", async () => {
    // Dialog grupy ma WŁASNĄ paczkę i własne rozgrzewanie na najechaniu
    // („nowa grupa"), więc połknięcie odrzucenia trzeba dowieść osobno -
    // wspólny `.catch` nie istnieje.
    vi.resetModules();
    vi.doMock("@/components/chat/GroupCreateDialog", () => Promise.reject(new Error("brak sieci")));

    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    globalThis.addEventListener?.("unhandledrejection", onRejection);

    const { prefetchGroupCreateDialog } = await import("@/components/chat/chatWindowChunk");
    expect(() => prefetchGroupCreateDialog()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    globalThis.removeEventListener?.("unhandledrejection", onRejection);
    expect(rejections).toEqual([]);

    vi.doUnmock("@/components/chat/GroupCreateDialog");
    vi.resetModules();
  });
});

describe("idempotencja - dziesiąte najechanie nic nie kosztuje", () => {
  it("wielokrotne rozgrzanie tej samej paczki wykonuje moduł RAZ", async () => {
    vi.resetModules();
    let evaluations = 0;
    vi.doMock("../organisms/SavedPanel", () => {
      evaluations += 1;
      return { SavedPanel: () => null };
    });

    const { prefetchDockPanel } = await import("../panelChunks");
    for (let i = 0; i < 10; i += 1) prefetchDockPanel("saved");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Cache modułów bundlera (i rejestru testowego) daje idempotencję
    // za darmo - ta asercja pilnuje, że nikt jej nie zepsuje, dokładając
    // np. własny znacznik czasu do ścieżki importu.
    expect(evaluations).toBe(1);

    vi.doUnmock("../organisms/SavedPanel");
    vi.resetModules();
  });
});
