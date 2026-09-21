import { test, expect, devices } from "@playwright/test";

// Publiczne strony nie mogą przesuwać się w bok - dopuszczalny jest wyłącznie
// ruch w pionie. Regresja z sierpnia 2026: zwijany header trzymał chrome w
// układzie szerszy niż viewport (width: 100%/scale), przez co na iOS Safari
// dało się przeciągnąć całą stronę w prawo, a pasek czytania wpisu chował się
// poza kadrem. Test jest backend-agnostyczny (CI używa zastępczych danych
// Supabase): mierzy geometrię shellu, która renderuje się bez danych.
//
// Uzupełnia gate źródłowy src/lib/ci/__tests__/horizontalPanGuard.test.ts:
// tam sprawdzamy reguły CSS, tutaj realne wymiary w przeglądarce.
//
// PODZIAŁ ODPOWIEDZIALNOŚCI WEWNĄTRZ TEGO TESTU. Werdykt stoi na dwóch
// asercjach TWARDYCH - szerokość dokumentu i `scrollLeft` - bo tylko one
// mierzą to, czego dotyczy incydent: czy stroną DA SIĘ ruszyć w bok. Lista
// `offenders` jest warstwą DIAGNOSTYCZNĄ nad nimi: ma nazwać element, który
// poszerzył kadr, żeby nikt nie zgadywał z samej liczby pikseli. Diagnostyka
// nie może jednak zapalać się na czerwono sama z siebie - element, którego
// nadmiar jest PRZYCIĘTY przez kontener wewnątrz strony, fizycznie nie
// przesunie dokumentu i na tej liście być nie powinien.
//
// Wrzesień 2026 (PR #383): lista zapalała się na /blog, choć obie twarde
// asercje przechodziły. Przy martwym backendzie trasa renderuje uczciwy
// `DegradedDataNotice` (FriendlyErrorPage variant="compact") zamiast pustego
// „Brak wpisów", a jego dekoracyjna poświata `-right-10` sięga 23 px poza
// viewport WEWNĄTRZ karty `relative overflow-hidden`. Bramka pokazywała więc
// nie regresję układu, tylko własną ślepotę na przodków przycinających.

const MOBILE = devices["iPhone 14"].viewport ?? { width: 390, height: 844 };
const ROUTES = ["/", "/blog", "/login"];

test.describe("brak poziomego przesuwania strony", () => {
  test.use({ viewport: MOBILE });

  for (const route of ROUTES) {
    test(`${route} mieści się w szerokości ekranu (mobile)`, async ({ page }) => {
      await page.goto(route);
      // Zwijanie headera i paski pojawiające się po scrollu włączają się dopiero
      // w trakcie przewijania - mierzymy PO scrollu, bo to tam był problem.
      await page.evaluate(() => window.scrollTo({ top: 900 }));
      await page.waitForTimeout(700);

      const metrics = await page.evaluate(() => {
        const de = document.documentElement;
        de.scrollLeft = 500;
        const scrollLeft = de.scrollLeft;
        de.scrollLeft = 0;

        /**
         * Czy ten przodek tworzy blok zawierający dla potomka `fixed`?
         * Lista własności jest krótka i zamknięta w specyfikacji: transform,
         * perspective, filter (także `backdrop-filter`), zapowiedź którejś
         * z nich w `will-change` oraz `contain` z izolacją malowania/układu.
         */
        const makesContainingBlock = (style: CSSStyleDeclaration) =>
          style.transform !== "none" ||
          style.perspective !== "none" ||
          style.filter !== "none" ||
          style.getPropertyValue("backdrop-filter") !== "none" ||
          /\b(paint|layout|strict|content)\b/.test(style.getPropertyValue("contain")) ||
          /\b(transform|perspective|filter|contain)\b/.test(style.getPropertyValue("will-change"));

        /**
         * Najbliższy przodek, który ODCINA nadmiar tego elementu od dokumentu -
         * albo `null`, gdy nadmiar propaguje się aż do strony.
         */
        const clippingAncestor = (el: HTMLElement): HTMLElement | null => {
          // Pozycja wędruje razem z nami w górę: o ucieczce przed clipem
          // decyduje schemat pozycjonowania elementu, który AKTUALNIE
          // propagujemy, a nie tego, od którego zaczęliśmy.
          let position = window.getComputedStyle(el).position;
          // Łańcuch kończy się na `body` WYŁĄCZNIE: clip korzenia
          // (`html, body { overflow-x: clip }`) to dokładnie to zabezpieczenie,
          // które WebKit zignorował w incydencie z sierpnia 2026. Gdyby liczyło
          // się jako przycięcie, lista byłaby pusta zawsze, a diagnostyka
          // martwa. Ufamy tu tylko kontenerom WEWNĄTRZ strony.
          for (
            let ancestor = el.parentElement;
            ancestor && ancestor !== document.body;
            ancestor = ancestor.parentElement
          ) {
            const style = window.getComputedStyle(ancestor);
            // `overflow` NIE przycina potomka, dla którego dany przodek nie
            // jest blokiem zawierającym: `absolute` przeskakuje przodka
            // nieposycjonowanego, a `fixed` - każdego, który bloku
            // zawierającego nie tworzy. Bez tego warunku heurystyka
            // wyciszyłaby dokładnie tę klasę regresji, którą opisuje punkt 2
            // bramki źródłowej: element `fixed` poza szerokością viewportu
            // mimo clipa na korzeniu.
            const clipsThisElement =
              position === "fixed"
                ? makesContainingBlock(style)
                : position === "absolute"
                  ? style.position !== "static" || makesContainingBlock(style)
                  : true;
            if (!clipsThisElement) continue;
            // Cztery wartości przerywają łańcuch, każda z innego powodu:
            // `hidden` i `clip` odcinają malowanie na krawędzi boksu
            // dopełnienia (`clip` dodatkowo odbiera skryptowi przewijanie),
            // a `auto` i `scroll` robią z przodka WŁASNY kontener przewijania -
            // nadmiar jest wtedy osiągalny gestem WEWNĄTRZ niego (tabela,
            // <pre>, karuzela), a nie przesunięciem STRONY, bo zakres
            // przewijania dokumentu liczy się już tylko z boksu przodka.
            // `visible` jako jedyna propaguje nadmiar wyżej.
            if (style.overflowX !== "visible") return ancestor;
            position = style.position;
          }
          return null;
        };

        const offenders: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.right <= de.clientWidth + 1) continue;
          // Przycięty potomek nie trafia na listę nawet wtedy, gdy przycinający
          // przodek sam wystaje poza kadr: ten przodek przechodzi przez tę samą
          // pętlę (`body *`) i zgłosi się SAM, pod własnym selektorem. Werdykt
          // wskazuje więc element, który naprawdę poszerza stronę, a nie
          // dekorację schowaną w jego środku.
          if (clippingAncestor(el)) continue;
          offenders.push(
            `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)} right=${Math.round(box.right)}`,
          );
        }
        return {
          clientWidth: de.clientWidth,
          scrollWidth: de.scrollWidth,
          scrollLeft,
          touchAction: window.getComputedStyle(de).touchAction,
          offenders: offenders.slice(0, 8),
        };
      });

      expect(metrics.scrollWidth, "dokument nie jest szerszy niż viewport").toBeLessThanOrEqual(
        metrics.clientWidth + 1,
      );
      expect(metrics.scrollLeft, "dokumentu nie da się przewinąć w poziomie").toBe(0);
      expect(metrics.offenders, "elementy wychodzące poza prawą krawędź").toEqual([]);
    });
  }

  test("gest poziomy jest zablokowany, pinch-zoom zostaje", async ({ page }) => {
    await page.goto("/");
    const touchAction = await page.evaluate(
      () => window.getComputedStyle(document.documentElement).touchAction,
    );
    expect(touchAction).toContain("pan-y");
    expect(touchAction).toContain("pinch-zoom");
  });
});
