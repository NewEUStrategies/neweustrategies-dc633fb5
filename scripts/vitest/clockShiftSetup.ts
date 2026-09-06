/**
 * PRZESTAWIENIE ZEGARA PROCESU NA POTRZEBY POMIARU DŁUGU BOMB ZEGAROWYCH.
 *
 * Ten plik NIE jest wpięty w `vitest.config.ts` i nie może być. Podaje się go
 * doraźnie, obok stałego setupu repozytorium:
 *
 *   CLOCK_SHIFT=1y ./node_modules/.bin/vitest run \
 *     --setupFiles ./vitest.setup.ts --setupFiles ./scripts/vitest/clockShiftSetup.ts
 *
 * PO CO. Bomba zegarowa w teście to literał daty, którego odległość od „teraz"
 * rośnie z każdą dobą, aż przekroczy okno czytane przez produkcję z prawdziwego
 * zegara. Takiego długu NIE MIERZY licznik czerwieni na dzisiejszej dacie -
 * mierzy go dopiero przebieg z zegarem przestawionym w przód. Liczba czerwieni
 * przy `CLOCK_SHIFT=1y` jest jedyną liczbą, która mówi, ile plików było
 * naprawdę bombami, a nie tylko wygląda na bezpieczne, bo ich okno jeszcze się
 * nie domknęło.
 *
 * DLACZEGO PODMIANA `Date`, A NIE `vi.useFakeTimers`. Fałszywe zegary vitest
 * zatrzymują też `setTimeout`, na którym stoją `waitFor` i debounce'y - włączone
 * globalnie wywróciłyby suitę z powodu, który nie ma nic wspólnego z datami.
 * Tu podmieniany jest WYŁĄCZNIE `Date`: czas nadal PŁYNIE, jest tylko
 * przesunięty o stały offset. Testy mierzące czas trwania (`Date.now() - start`)
 * liczą różnice, więc offset się w nich skraca i są na to obojętne.
 *
 * WSPÓŁISTNIENIE Z `vi.useFakeTimers()`. Fałszywy zegar instaluje się NA
 * podmienionym `Date` i zapamiętuje jego wskazanie w chwili instalacji. Test,
 * który zamraża zegar na dacie BEZWZGLĘDNEJ (`vi.setSystemTime(new Date(...))`),
 * jest więc na ten offset odporny - i o to chodzi. Test, który woła
 * `vi.useFakeTimers()` BEZ podania daty, zakotwicza się na przesuniętym
 * „teraz" - i taki właśnie ma tu wyjść na jaw, bo jego zamrożenie jest pozorne.
 */

/** Rozkłada `1d`, `2h`, `-3d`, `1y`, `5y` albo gołe milisekundy na offset w ms. */
function parseShift(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(
      `clockShiftSetup: nie rozumiem CLOCK_SHIFT="${raw}". Użyj np. 1d, 12h, 1y, 5y albo liczby ms.`,
    );
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  const factor: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    // Rok liczony jako 365 dni. Pomiar dotyczy okien rzędu godzin i dni, więc
    // dzień przestępny nie zmienia żadnego wyniku, a kalendarzowa arytmetyka
    // wprowadzałaby zależność od daty przebiegu.
    y: 365 * 86_400_000,
  };
  return amount * factor[unit];
}

const OFFSET_MS = parseShift(process.env.CLOCK_SHIFT ?? "");

if (OFFSET_MS !== 0) {
  const RealDate = Date;

  // Proxy, a nie `class ... extends Date`. Podklasa musiałaby zadeklarować
  // sygnaturę konstruktora, a `ConstructorParameters<DateConstructor>` zwija
  // się do OSTATNIEGO przeciążenia (jednoargumentowego), więc `new Date(2026,
  // 0, 1)` przestałoby się typować, a przekazanie brakujących argumentów jako
  // `undefined` daje `Invalid Date`. `Reflect.construct` przepuszcza dowolną
  // arność bez zgadywania, a proxy zachowuje `Date.parse`, `Date.UTC`,
  // prototyp i `instanceof`.
  const ShiftedDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      // Tylko `new Date()` bez argumentów czyta zegar. Każde inne wywołanie to
      // jawna data i musi zostać nietknięte - inaczej przesunęlibyśmy literały
      // w fixture'ach, czyli dokładnie to, co próbujemy zmierzyć.
      if (args.length === 0)
        return Reflect.construct(target, [target.now() + OFFSET_MS], newTarget);
      return Reflect.construct(target, args, newTarget);
    },
    get(target, prop, receiver) {
      if (prop === "now") return () => target.now() + OFFSET_MS;
      return Reflect.get(target, prop, receiver);
    },
  });

  globalThis.Date = ShiftedDate;

  console.info(
    `[clockShiftSetup] CLOCK_SHIFT=${process.env.CLOCK_SHIFT} -> offset ${OFFSET_MS} ms; "teraz" = ${new ShiftedDate().toISOString()}`,
  );
}
