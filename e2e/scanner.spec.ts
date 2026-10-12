import { test, expect, type Page, type Route } from "@playwright/test";

// E2E aplikacji skanera on-site (`/scanner`).
//
// PŁASZCZYZNA URZĄDZENIA JEST ZAŚLEPIONA NA POZIOMIE SIECI, NIE MOCKA MODUŁU.
// Skaner rozmawia z bazą przez trzy RPC (`event_scanner_bootstrap`,
// `event_checkin_record`, `event_lead_scan_record`), a w CI nie ma bazy - więc
// przechwytujemy dokładnie te adresy. Dzięki temu test przechodzi przez PRAWDZIWY
// kod trasy, hooka, kolejki IndexedDB i UI, a udaje tylko to, czego w CI nie ma.
//
// Sprawdzamy trzy rzeczy, o które prosi scenariusz przy bramce:
// parowanie (kod z panelu i kod z linku), zapis do kolejki przy braku sieci
// (z weryfikacją IndexedDB, nie tylko napisu) i reakcję ekranu na wynik skanu.
//
// LINK PAROWANIA NIESIE TOKEN WE FRAGMENCIE (`/scanner#t=`, OPS-07) - stary
// link `?t=` nie paruje. KOLEJKA W INDEXEDDB JEST ZASZYFROWANA (OPS-06):
// rekord ma skrót i prefiks kodu, a sam kod tylko w bloku AES-GCM.

const DEVICE_TOKEN = "e2e-scanner-token-0123456789";
const CHECKPOINT_ID = "11111111-1111-4111-8111-111111111111";

const SESSION = {
  device_id: "22222222-2222-4222-8222-222222222222",
  label: "Recepcja A",
  scopes: ["checkin"],
  expires_at: null,
  pinned_checkpoint_id: CHECKPOINT_ID,
  sponsor_id: null,
  event: {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "e2e-kongres",
    title_pl: "Kongres testowy",
    title_en: "Test congress",
    starts_at: null,
    ends_at: null,
    timezone: "Europe/Warsaw",
  },
  checkpoints: [
    {
      id: CHECKPOINT_ID,
      name_pl: "Wejście główne",
      name_en: "Main entrance",
      kind: "event_entry",
      direction_mode: "in_only",
      access_mode: "control",
      capacity: null,
      dedupe_window_seconds: 0,
      sort_order: 0,
    },
  ],
};

const GRANTED_SCAN = {
  outcome: "granted",
  admit: true,
  result: "granted",
  checkin_id: "44444444-4444-4444-8444-444444444444",
  direction: "in",
  occurred_at: "2026-05-01T08:00:00.000Z",
  repeat_count: 0,
  previous_checkin_at: null,
  device_locked: false,
  checkpoint: { id: CHECKPOINT_ID, name_pl: "Wejście główne", name_en: "Main entrance" },
  person: { person_id: "55555555-5555-4555-8555-555555555555", first_name: "Anna" },
  other_event: null,
};

interface ScannerCalls {
  bootstrap: number;
  checkin: Array<Record<string, unknown>>;
}

/** Zaślepia płaszczyznę urządzenia i zwraca licznik wywołań do asercji. */
async function stubScannerPlane(page: Page): Promise<ScannerCalls> {
  const calls: ScannerCalls = { bootstrap: 0, checkin: [] };

  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/rest/v1/rpc/event_scanner_bootstrap*", async (route) => {
    calls.bootstrap += 1;
    await json(route, SESSION);
  });

  await page.route("**/rest/v1/rpc/event_checkin_record*", async (route) => {
    const raw = route.request().postDataJSON() as { p_payload?: Record<string, unknown> } | null;
    calls.checkin.push(raw?.p_payload ?? {});
    await json(route, GRANTED_SCAN);
  });

  return calls;
}

/** Rekord kolejki na dysku - metadane, skrót i prefiks; kod tylko w bloku `sealed`. */
type StoredScan = Record<string, unknown> & { id: string; kind: string };

/** Kolejka zapisana na urządzeniu - czytana z IndexedDB, nie z ekranu. */
async function readOutbox(page: Page): Promise<StoredScan[]> {
  return page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown> & { id: string; kind: string }>>((resolve) => {
        const open = window.indexedDB.open("nes-scanner", 1);
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("outbox")) {
            db.close();
            resolve([]);
            return;
          }
          const request = db.transaction("outbox", "readonly").objectStore("outbox").get("queue");
          request.onerror = () => {
            db.close();
            resolve([]);
          };
          request.onsuccess = () => {
            const value: unknown = request.result;
            db.close();
            resolve(
              Array.isArray(value)
                ? (value as Array<Record<string, unknown> & { id: string; kind: string }>)
                : [],
            );
          };
        };
      }),
  );
}

test.describe("aplikacja skanera", () => {
  // Dev server renderuje strumieniowo i domyka dokument dopiero po strażniku
  // bezczynności - dlatego nawigujemy do `domcontentloaded` i dajemy zapas czasu.
  test.describe.configure({ timeout: 90_000 });

  test("bez poświadczenia pokazuje parowanie i zostaje poza indeksem", async ({ page }) => {
    const errors: string[] = [];
    // Trasa skanera jest `ssr: false`, a w CI nie ma bazy - React zgłasza wtedy
    // przejście na render kliencki. To nie jest wyjątek aplikacji, więc nie
    // liczymy go jako błędu strony.
    page.on("pageerror", (e) => {
      const message = String(e);
      if (message.includes("Suspense boundary")) return;
      errors.push(message);
    });
    const calls = await stubScannerPlane(page);

    await page.goto("/scanner", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Podłącz urządzenie" })).toBeVisible();
    await expect(page.locator("#scanner-token")).toBeVisible();
    // Adres bywa otwierany z linku zawierającym poświadczenie - nie ma go
    // w indeksie, a instalowalny jest skaner, nie portal.
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    await expect(
      page.locator('link[rel="manifest"][href="/scanner/manifest.webmanifest"]'),
    ).toHaveCount(1);
    // Brak tokenu = brak wywołania bramki.
    expect(calls.bootstrap).toBe(0);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("kod o złym kształcie jest odrzucany bez żądania", async ({ page }) => {
    const calls = await stubScannerPlane(page);
    await page.goto("/scanner", { waitUntil: "domcontentloaded" });

    await page.locator("#scanner-token").fill("za-krotki");
    await page.locator("#scanner-token").blur();

    await expect(page.getByText(/kod|code/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Podłącz" }).click();
    expect(calls.bootstrap).toBe(0);
    // Ekran parowania zostaje - nic się nie wydarzyło.
    await expect(page.locator("#scanner-token")).toBeVisible();
  });

  test("parowanie kodem z panelu otwiera tryb odprawy", async ({ page }) => {
    const calls = await stubScannerPlane(page);
    await page.goto("/scanner", { waitUntil: "domcontentloaded" });

    await page.locator("#scanner-token").fill(DEVICE_TOKEN);
    await page.getByRole("button", { name: "Podłącz" }).click();

    await expect(page.getByText("Kongres testowy")).toBeVisible();
    await expect(page.getByText("Urządzenie: Recepcja A")).toBeVisible();
    await expect(page.locator("#scanner-code")).toBeVisible();
    expect(calls.bootstrap).toBeGreaterThanOrEqual(1);

    // Poświadczenie przeżywa zamknięcie karty - inaczej wolontariusz wpisywałby
    // je po każdym wygaszeniu ekranu.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("nes.scanner.device-token"),
    );
    expect(stored).toBe(DEVICE_TOKEN);
  });

  test("parowanie linkiem z panelu (token we FRAGMENCIE) czyści poświadczenie z adresu", async ({
    page,
  }) => {
    const calls = await stubScannerPlane(page);
    // Żadne żądanie dokumentu nie może nieść tokenu - fragmentu przeglądarka
    // nie wysyła na serwer (OPS-07).
    const documentUrls: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentUrls.push(request.url());
    });

    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#scanner-code")).toBeVisible();
    // W trybie deweloperskim React montuje efekty dwa razy, więc liczymy
    // „przynajmniej jedno" - istotne jest, że link sam paruje urządzenie.
    expect(calls.bootstrap).toBeGreaterThanOrEqual(1);
    // Token nie ma prawa zostać w pasku adresu ani w historii.
    await expect(page).toHaveURL(/\/scanner$/);
    expect(page.url()).not.toContain(DEVICE_TOKEN);
    expect(documentUrls.some((url) => url.includes(DEVICE_TOKEN))).toBe(false);
  });

  test("STARY link `?t=` nie paruje urządzenia i prosi o nowy kod QR", async ({ page }) => {
    const calls = await stubScannerPlane(page);

    await page.goto(`/scanner?t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Podłącz urządzenie" })).toBeVisible();
    await expect(page.getByText(/Ten link parowania ma stary format/)).toBeVisible();
    // Token z zapytania już wyciekł - nie łączymy nim urządzenia.
    expect(calls.bootstrap).toBe(0);
    await expect(page).toHaveURL(/\/scanner$/);
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("nes.scanner.device-token"),
    );
    expect(stored).toBeNull();
  });

  test("odłączenie urządzenia wraca do parowania i kasuje poświadczenie", async ({ page }) => {
    await stubScannerPlane(page);
    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scanner-code")).toBeVisible();

    await page.getByRole("button", { name: "Odłącz urządzenie" }).first().click();

    await expect(page.getByRole("heading", { name: "Podłącz urządzenie" })).toBeVisible();
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("nes.scanner.device-token"),
    );
    expect(stored).toBeNull();
  });

  test("skan online pokazuje decyzję bazy i nie zostawia nic w kolejce", async ({ page }) => {
    const calls = await stubScannerPlane(page);
    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scanner-code")).toBeVisible();

    await page.locator("#scanner-code").fill("TICKET-ONLINE-1");
    await page.locator("#scanner-code").press("Enter");

    // Wynik jest treścią strony, nie znikającym powiadomieniem.
    await expect(page.getByText("Wpuść")).toBeVisible();
    expect(calls.checkin).toHaveLength(1);
    expect(calls.checkin[0]).toMatchObject({
      device_token: DEVICE_TOKEN,
      code: "TICKET-ONLINE-1",
      checkpoint_id: CHECKPOINT_ID,
      direction: "in",
    });
    // Pole czyści się samo, żeby drugi skan nie dokleił się do pierwszego.
    await expect(page.locator("#scanner-code")).toHaveValue("");
    expect(await readOutbox(page)).toHaveLength(0);
  });

  test("bez sieci skan trafia do kolejki, a po powrocie sieci zostaje wysłany", async ({
    page,
  }) => {
    const calls = await stubScannerPlane(page);
    // Brak sieci udajemy PRZEGLĄDARCE, a nie łączu: dev server dogrywa moduły
    // w trakcie pracy, więc realne odcięcie transportu wywracałoby aplikację
    // zamiast testować kolejkę. Flaga steruje `navigator.onLine`, czyli
    // dokładnie tym sygnałem, na którym opiera się skaner.
    await page.addInitScript(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = false;
      Object.defineProperty(window.navigator, "onLine", {
        get: () => !(window as unknown as { __scannerOffline: boolean }).__scannerOffline,
      });
    });

    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scanner-code")).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = true;
      window.dispatchEvent(new Event("offline"));
    });

    await page.locator("#scanner-code").fill("TICKET-OFFLINE-1");
    await page.locator("#scanner-code").press("Enter");

    // 1) Reakcja UI: potwierdzenie zapisu i widoczna kolejka.
    await expect(page.getByText("Zapisano")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kolejka skanów" })).toBeVisible();
    await expect(page.getByText("1 skan czeka na wysłanie")).toBeVisible();

    // 2) Zapis do outbox: sprawdzamy IndexedDB, nie napis na ekranie.
    await expect.poll(async () => (await readOutbox(page)).length, { timeout: 10_000 }).toBe(1);
    const queued = await readOutbox(page);
    // OPS-06: rekord niesie skrót i prefiks - jawny kod tylko w bloku AES-GCM.
    expect(queued[0]).toMatchObject({ kind: "checkin", codePrefix: "TICKET" });
    expect(queued[0]).not.toHaveProperty("code");
    expect(queued[0].sealed).toMatchObject({ iv: expect.any(String), data: expect.any(String) });
    expect(JSON.stringify(queued)).not.toContain("TICKET-OFFLINE-1");
    expect(calls.checkin).toHaveLength(0);

    // 3) Powrót sieci opróżnia kolejkę bez udziału człowieka.
    await page.evaluate(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = false;
      window.dispatchEvent(new Event("online"));
    });

    await expect.poll(() => calls.checkin.length, { timeout: 30_000 }).toBe(1);
    expect(calls.checkin[0]).toMatchObject({ code: "TICKET-OFFLINE-1" });
    await expect.poll(async () => (await readOutbox(page)).length, { timeout: 10_000 }).toBe(0);
    await expect(page.getByRole("heading", { name: "Kolejka skanów" })).toBeHidden();
  });

  test("kolejka przeżywa przeładowanie karty", async ({ page }) => {
    await stubScannerPlane(page);
    // Udajemy brak sieci PRZEGLĄDARCE, nie łączu: dzięki temu przeładowanie
    // karty nadal pobiera zasoby, a skaner mimo to kolejkuje skany - czyli
    // testujemy trwałość kolejki, a nie zdolność dev servera do serwowania offline.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "onLine", { get: () => false });
    });

    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scanner-code")).toBeVisible();

    await page.locator("#scanner-code").fill("TICKET-PERSIST-1");
    await page.locator("#scanner-code").press("Enter");
    await expect(page.getByText("1 skan czeka na wysłanie")).toBeVisible();
    await expect.poll(async () => (await readOutbox(page)).length, { timeout: 10_000 }).toBe(1);

    await page.reload({ waitUntil: "domcontentloaded" });

    // Poświadczenie z pamięci urządzenia wznawia sesję, a kolejka wraca z dysku.
    await expect(page.getByText("Kongres testowy")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kolejka skanów" })).toBeVisible();
    await expect(page.getByText("1 skan czeka na wysłanie")).toBeVisible();
    const restored = await readOutbox(page);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ kind: "checkin", codePrefix: "TICKET" });
    expect(JSON.stringify(restored)).not.toContain("TICKET-PERSIST-1");
  });

  test("po wysyłce i odłączeniu w IndexedDB i localStorage nie zostaje żaden kod (OPS-06)", async ({
    page,
  }) => {
    const calls = await stubScannerPlane(page);
    await page.addInitScript(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = false;
      Object.defineProperty(window.navigator, "onLine", {
        get: () => !(window as unknown as { __scannerOffline: boolean }).__scannerOffline,
      });
    });
    await page.goto(`/scanner#t=${DEVICE_TOKEN}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#scanner-code")).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = true;
      window.dispatchEvent(new Event("offline"));
    });
    const code = "Qr1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT";
    await page.locator("#scanner-code").fill(code);
    await page.locator("#scanner-code").press("Enter");
    await expect.poll(async () => (await readOutbox(page)).length, { timeout: 10_000 }).toBe(1);

    await page.evaluate(() => {
      (window as unknown as { __scannerOffline: boolean }).__scannerOffline = false;
      window.dispatchEvent(new Event("online"));
    });
    await expect.poll(() => calls.checkin.length, { timeout: 30_000 }).toBe(1);
    expect(calls.checkin[0]).toMatchObject({ code });
    await expect.poll(async () => (await readOutbox(page)).length, { timeout: 10_000 }).toBe(0);

    await page.getByRole("button", { name: "Odłącz urządzenie" }).first().click();
    await expect(page.getByRole("heading", { name: "Podłącz urządzenie" })).toBeVisible();

    // Każda wartość z obu baz skanera i z localStorage - wzorcem kodu z biletu.
    const atRest = await page.evaluate(async () => {
      const dump = (name: string, store: string) =>
        new Promise<string>((resolve) => {
          const open = window.indexedDB.open(name);
          open.onerror = () => resolve("");
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(store)) {
              db.close();
              resolve("");
              return;
            }
            const values: unknown[] = [];
            const cursor = db.transaction(store, "readonly").objectStore(store).openCursor();
            cursor.onsuccess = () => {
              const current = cursor.result;
              if (current === null) {
                db.close();
                resolve(JSON.stringify(values));
                return;
              }
              values.push(current.key, current.value);
              current.continue();
            };
            cursor.onerror = () => resolve(JSON.stringify(values));
          };
        });
      return {
        idb: [
          await dump("nes-scanner", "outbox"),
          await dump("nes-scanner-offline", "records"),
        ].join("\n"),
        local: JSON.stringify({ ...window.localStorage }),
      };
    });
    // Bazy skanera: ani jednego napisu w kształcie kodu z biletu.
    expect(atRest.idb).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/);
    // `localStorage` dzieli origin z resztą aplikacji - tam szukamy dosłownie.
    for (const value of [atRest.idb, atRest.local]) {
      expect(value).not.toContain(code);
      expect(value).not.toContain(DEVICE_TOKEN);
    }
  });
});
