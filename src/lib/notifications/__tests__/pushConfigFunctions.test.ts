// `getPushPublicKey` - serwerowa funkcja, przez którą klient dostaje klucz
// publiczny VAPID do `PushManager.subscribe`. Do 01.09.2026: 0 z 3 linii,
// 0 z 1 funkcji, mimo że to JEDYNE wejście do włączenia pusha w przeglądarce.
//
// Co tu jest naprawdę do stracenia: klucz jest trzymany w sekretach serwera
// (a nie w zmiennej build-time) właśnie po to, żeby rotacja nie wymagała
// przebudowy frontu. Cena tej wygody to gałąź fallbacku i rozróżnienie
// „klucza nie ma" od „klucz jest pusty". Pusty napis oddany klientowi kończy
// się wyjątkiem w `PushManager.subscribe` (applicationServerKey zerowej
// długości), czyli zepsutym przyciskiem zgody zamiast czytelnego „push
// niedostępny" - i to jest defekt, którego ten plik pilnuje.
//
// Handler jest wołany przez harness (`src/test/serverFnHarness.ts`), bo bez
// runtime'u TanStack Start `createServerFn(...).handler(...)` nie jest
// wywoływalny. Harness NIE uruchamia middleware - tu i tak żadnego nie ma,
// bo klucz publiczny VAPID jest z definicji jawny.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asServerFn, callServerFn } from "@/test/serverFnHarness";
import { generateVapidKeys } from "@/lib/notifications/webpush.server";

// UWAGA na hoistowanie: `vi.mock` wjeżdża NAD importy, więc testowany moduł
// musi być wciągnięty dynamicznie PO rejestracji atrapy - inaczej złapałby
// prawdziwe `createServerFn`, którego w teście nie da się wywołać.
vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

const { getPushPublicKey } = await import("@/lib/notifications/pushConfig.functions");

interface PushConfig {
  publicKey: string | null;
}

/** Klucz WYŁĄCZNIE z generatora modułu web push - żadnej wartości z .env. */
const { publicKey: KEY } = generateVapidKeys();
const OTHER_KEY = generateVapidKeys().publicKey;

const ENV_KEYS = ["VAPID_PUBLIC_KEY", "VITE_VAPID_PUBLIC_KEY"] as const;
const saved = new Map<string, string | undefined>();

function read(): Promise<PushConfig> {
  return callServerFn<PushConfig>(getPushPublicKey, { context: { supabase: null } });
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("getPushPublicKey", () => {
  it("oddaje VAPID_PUBLIC_KEY", async () => {
    process.env.VAPID_PUBLIC_KEY = KEY;

    expect(await read()).toEqual({ publicKey: KEY });
  });

  it("spada na VITE_VAPID_PUBLIC_KEY, gdy nie ma wariantu serwerowego", async () => {
    // Ta sama para kluczy bywa wystawiona tylko pod nazwą build-time. Bez
    // fallbacku przycisk „włącz powiadomienia" milczałby przy POPRAWNIE
    // skonfigurowanym środowisku.
    process.env.VITE_VAPID_PUBLIC_KEY = KEY;

    expect(await read()).toEqual({ publicKey: KEY });
  });

  it("wariant serwerowy wygrywa z build-time (rotacja bez przebudowy frontu)", async () => {
    // Sedno decyzji projektowej: po rotacji serwer i klient MUSZĄ widzieć tę
    // samą parę, więc świeży sekret serwera bije zastaną wartość z builda.
    process.env.VAPID_PUBLIC_KEY = KEY;
    process.env.VITE_VAPID_PUBLIC_KEY = OTHER_KEY;

    expect(await read()).toEqual({ publicKey: KEY });
  });

  it("brak obu zmiennych daje null (push nieskonfigurowany)", async () => {
    expect(await read()).toEqual({ publicKey: null });
  });

  it("pusty napis to BRAK konfiguracji, a nie klucz zerowej długości", async () => {
    // `applicationServerKey: ""` wywraca `PushManager.subscribe` po stronie
    // przeglądarki. Kontrakt: null znaczy „nie pokazuj zgody na push".
    process.env.VAPID_PUBLIC_KEY = "";

    expect(await read()).toEqual({ publicKey: null });
  });

  it("pusty wariant serwerowy przepuszcza fallback build-time", async () => {
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VITE_VAPID_PUBLIC_KEY = KEY;

    expect(await read()).toEqual({ publicKey: KEY });
  });

  it("oba puste dają null", async () => {
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VITE_VAPID_PUBLIC_KEY = "";

    expect(await read()).toEqual({ publicKey: null });
  });

  it("jest deklarowana jako GET", () => {
    // GET, bo to odczyt jawnej konfiguracji: pozwala na cache po stronie
    // klienta i nie wymaga tokenu CSRF, którego publiczny klucz nie potrzebuje.
    expect(asServerFn(getPushPublicKey).method).toBe("GET");
  });
});
