// rAF-throttle dla gorących handlerów scroll/resize: dowolnie gęsty strumień
// zdarzeń zbija się do JEDNEGO wywołania na klatkę animacji (z ostatnimi
// argumentami), więc praca - odczyty layoutu, setState - dzieje się co najwyżej
// raz na paint zamiast setki razy na sekundę. `cancel()` w cleanupie efektu
// gwarantuje, że zaplanowana klatka nie strzeli po odmontowaniu komponentu.

export interface RafThrottled<Args extends unknown[]> {
  (...args: Args): void;
  cancel: () => void;
}

export function rafThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
): RafThrottled<Args> {
  let frame: number | null = null;
  let lastArgs: Args | null = null;

  const throttled = (...args: Args): void => {
    lastArgs = args;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (lastArgs) fn(...lastArgs);
    });
  };

  return Object.assign(throttled, {
    cancel: (): void => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      lastArgs = null;
    },
  });
}
