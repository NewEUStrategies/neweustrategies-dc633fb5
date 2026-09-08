import { test, expect } from "@playwright/test";

// REZERWACJA DOLNEJ KRAWĘDZI POWSTAJE PRZED PIERWSZYM MALOWANIEM.
//
// ── CO TU JEST MIERZONE I DLACZEGO WŁAŚNIE W PRZEGLĄDARCE ────────────────
// Pasek przestrzeni roboczej jest `position: fixed` przy dolnej krawędzi,
// a pojawia się PÓŹNO: sesja Supabase rozstrzyga się w efekcie, potem trzeba
// dociągnąć leniwą powłokę doku, i tylko wtedy biegnie pomiar wysokości.
// Rezerwacja robiona po tym łańcuchu wchodziła sekundy po pierwszym malowaniu,
// a CLS nalicza się przez całe życie strony, nie tylko w okienku wczytania.
//
// Naprawą jest skrypt w `<head>`, który odtwarza rezerwację z wysokości
// ZMIERZONEJ przy poprzednim wejściu (`lib/dock/reservedSpace.ts`). Testy
// jednostkowe wykonują ten skrypt na atrapie dokumentu i dowodzą jego logiki;
// czego NIE mogą dowieść, to KOLEJNOŚCI wobec malowania - a to jest cała
// jego wartość. Tu mierzy się to w prawdziwej przeglądarce: czy w chwili
// pierwszego `requestAnimationFrame` dokumentu rezerwacja już stoi.
//
// Test jest BACKEND-AGNOSTYCZNY (CI używa zastępczych danych Supabase)
// i nie wymaga zalogowania: skrypt czyta wyłącznie LICZBĘ PIKSELI zapisaną
// lokalnie, nie stan uwierzytelnienia. To jest ta sama własność, która czyni
// go bezpiecznym w produkcji.
//
// Uzupełnia `src/lib/dock/__tests__/reservedSpace.test.ts` (logika i skrypt)
// oraz `src/components/dock/__tests__/WorkspaceDock.test.tsx` (publikacja
// pomiaru i sprzątanie).

const RESERVE_KEY = "nes.dock.reserve.v1";
const HEIGHT = 36;

/**
 * Zapisuje znacznik ZANIM dokument się wykona i zdejmuje pierwszą klatkę.
 * `addInitScript` biegnie przed skryptami strony, więc odtwarza sytuację
 * „drugie wejście użytkownika, który ma już zmierzony pasek".
 */
async function seedReserve(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key as string, String(value));
      } catch {
        /* tryb prywatny - test to zauważy brakiem rezerwacji */
      }
      // Stan `<html>` w chwili PIERWSZEJ klatki dokumentu. Odczyt w teście
      // po `goto()` byłby już po efektach Reacta i nie rozróżniałby skryptu
      // sprzed malowania od zwykłego efektu.
      window.requestAnimationFrame(() => {
        const root = document.documentElement;
        Object.assign(window as unknown as Record<string, unknown>, {
          __dockReserveFirstFrame: {
            marker: root.dataset.mbb ?? null,
            space: root.style.getPropertyValue("--mbb-space"),
          },
        });
      });
    },
    [RESERVE_KEY, HEIGHT] as const,
  );
}

function firstFrame(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, { marker: string | null; space: string } | undefined>)
        .__dockReserveFirstFrame ?? null,
  );
}

test.describe("rezerwacja doku przed pierwszym malowaniem", () => {
  test("zapamiętana wysokość stoi na <html> już w pierwszej klatce", async ({ page }) => {
    await seedReserve(page);
    await page.goto("/");
    const measured = await firstFrame(page);

    expect(measured, "brak pomiaru pierwszej klatki").not.toBeNull();
    expect(measured?.marker).toBe("on");
    expect(measured?.space).toBe(`${HEIGHT}px`);
  });

  test("rezerwacja przekłada się na realne dopełnienie treści", async ({ page }) => {
    await seedReserve(page);
    await page.goto("/");

    const padding = await page.evaluate(() =>
      Number.parseFloat(window.getComputedStyle(document.body).paddingBottom),
    );
    // `--mbb-reserve` to `--mbb-space` + 8 px odstępu treści od paska.
    // Bezpieczny obszar iOS jest już W ŚRODKU zmierzonej wysokości, więc
    // NIE dochodzi tu po raz drugi - to była naprawiona wada podwójnego
    // liczenia, dająca ~34 px martwego pasa na telefonie z wcięciem.
    expect(padding).toBeCloseTo(HEIGHT + 8, 0);
  });

  test("BEZ zapamiętanej wysokości gość nie dostaje pustego pasa", async ({ page }) => {
    await page.goto("/");
    const state = await page.evaluate(() => ({
      marker: document.documentElement.dataset.mbb ?? null,
      padding: window.getComputedStyle(document.body).paddingBottom,
    }));
    expect(state.marker).toBeNull();
    // Zero albo brak wartości - byle nie pas pod niczym.
    expect(["", "0px"]).toContain(state.padding);
  });

  test("na /login rezerwacji nie ma, bo tam paska nie ma", async ({ page }) => {
    await seedReserve(page);
    await page.goto("/login");
    const measured = await firstFrame(page);
    expect(measured?.marker).toBeNull();
    expect(measured?.space).toBe("");
  });

  test("rezerwacja działa na KAŻDEJ szerokości, nie tylko na telefonie", async ({ page }) => {
    // Blok CSS stał w `@media (max-width: 767.98px)`, choć pasek jest `fixed`
    // na każdej szerokości i ma osobny rząd desktopowy - od 768 px w górę
    // rezerwacji nie było wcale i pasek zasłaniał ostatni pas stopki.
    await seedReserve(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const padding = await page.evaluate(() =>
        Number.parseFloat(window.getComputedStyle(document.body).paddingBottom),
      );
      expect(padding, `szerokość ${width}px bez rezerwacji`).toBeCloseTo(HEIGHT + 8, 0);
    }
  });
});
