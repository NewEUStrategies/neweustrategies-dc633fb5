// Leniwy most do sonnera dla modułów na ŚCIEŻCE BOOTOWANIA.
//
// PO CO. Kilka modułów rozgrzewanych przez loader roota (designTokens,
// globalColors, themeDesign, fontSizes, customFonts) woła toasty w callbackach
// mutacji ADMINA - a statyczny `import { toast } from "sonner"` w każdym z nich
// trzymał całą bibliotekę (~63 kB źródeł) w chunku wejściowym KAŻDEJ strony
// publicznej. Toast to skutek interakcji operatora, nigdy pierwszego malowania,
// więc chunk sonnera może zejść z ścieżki bootowania w całości (Toaster w
// __root.tsx jest lazy z tego samego powodu).
//
// GWARANCJE:
//   - kolejność zachowana: wywołania sprzed załadowania modułu ustawiają się
//     w kolejce i schodzą FIFO po jego załadowaniu;
//   - po pierwszym załadowaniu (w praktyce: przy pierwszym toaście, chunk
//     jest już w cache HTTP po rozgrzaniu przez lazy <Toaster/>) wywołania
//     są synchroniczne jak dotąd;
//   - SSR: no-op (toasty nie mają sensu w renderze serwerowym; sonner i tak
//     renderuje je wyłącznie po stronie klienta).
//
// ŚWIADOMY KOMPROMIS: toast wystrzelony w oknie między hydratacją a montażem
// leniwego Toastera przepada (sonner nie odtwarza historii nowym
// subskrybentom - zweryfikowane w źródle: subscribe() nie robi replay).
// To okno istniało już wcześniej dla toastów sprzed hydratacji; mutacje
// operatora, jedyny realny nadawca, nie są w stanie zakończyć się przed nią.
type ToastFn = (message: string) => unknown;

let toastModule: { success: ToastFn; error: ToastFn } | null = null;
let loading: Promise<void> | null = null;
const queue: Array<() => void> = [];
/** Górna granica kolejki: toasty to dekoracja, nie bufor zdarzeń. */
const QUEUE_LIMIT = 20;

function flush(): void {
  while (queue.length > 0) queue.shift()?.();
}

// ── SYGNAŁ „PIERWSZE UŻYCIE" (dla leniwego montażu `<Toaster/>`) ───────────
//
// PO CO. `__root.tsx` montuje `<Toaster/>` (chunk sonnera) dopiero wtedy, gdy
// w tej karcie naprawdę pada pierwszy toast - inaczej `React.lazy` startował
// `import()` już w commicie hydratacji, czyli w oknie LCP KAŻDEJ strony
// (audyt CWV 2026-09-20, F19). Subskrypcja jest tu, a nie w `__root.tsx`, bo
// tylko ten moduł wie, kiedy toast naprawdę pada, i wie to ZANIM chunk
// sonnera dojedzie - dzięki kolejce FIFO wyżej toast z tego okna nie ginie.
//
// GRANICA, KTÓREJ TEN SYGNAŁ NIE PRZEKRACZA: widzi wyłącznie wywołania idące
// PRZEZ TEN MOST. Wywołania `import { toast } from "sonner"` wprost (w repo
// setki modułów, głównie panelu) są dla niego niewidzialne - dlatego
// `__root.tsx` trzyma OBOK niego drugie, bezwarunkowe wyzwalanie po
// bezczynności. Sygnał skraca czas do montażu w przypadku bootowym; nie jest
// jedynym warunkiem montażu i nie wolno go w taki zamienić.
const firstUseSubscribers = new Set<() => void>();
let firstUseSeen = false;

/**
 * Wywołuje `cb` przy PIERWSZYM toaście w tej karcie (albo natychmiast, jeśli
 * już padł). Zwraca funkcję odsubskrybowania - kontrakt efektu Reacta.
 */
export function onFirstToast(cb: () => void): () => void {
  if (firstUseSeen) {
    cb();
    return () => {};
  }
  firstUseSubscribers.add(cb);
  return () => firstUseSubscribers.delete(cb);
}

function announceFirstUse(): void {
  if (firstUseSeen) return;
  firstUseSeen = true;
  const subscribers = [...firstUseSubscribers];
  firstUseSubscribers.clear();
  // Subskrybent (setState w korzeniu) nie może wywrócić nadawcy toasta -
  // toast jest dekoracją, a nadawcą bywa callback mutacji.
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      /* montaż Toastera to dekoracja - nigdy nie wywraca wołającego */
    }
  }
}

/** Wyłącznie dla testów - zeruje pamięć „pierwszego użycia". */
export function resetFirstToastForTests(): void {
  firstUseSeen = false;
  firstUseSubscribers.clear();
}

function withToast(run: (t: { success: ToastFn; error: ToastFn }) => void): void {
  if (typeof window === "undefined") return; // SSR: no-op
  announceFirstUse();
  if (toastModule) {
    run(toastModule);
    return;
  }
  if (queue.length < QUEUE_LIMIT) {
    queue.push(() => {
      if (toastModule) run(toastModule);
    });
  }
  loading ??= import("sonner")
    .then((m) => {
      toastModule = m.toast;
      flush();
    })
    .catch(() => {
      // Chunk sonnera nie dojechał (sieć) - toasty są dekoracją, nie
      // blokujemy. `loading = null` pozwala NASTĘPNEMU wywołaniu ponowić
      // import (bez resetu każdy kolejny toast pchałby do kolejki, której
      // nikt już nigdy nie opróżni - rosłaby bez końca i bez efektu).
      queue.length = 0;
      loading = null;
    });
}

/** Leniwe `toast.success` - identyczna semantyka, zero sonnera w entry. */
export function notifySuccess(message: string): void {
  withToast((t) => t.success(message));
}

/** Leniwe `toast.error` - identyczna semantyka, zero sonnera w entry. */
export function notifyError(message: string): void {
  withToast((t) => t.error(message));
}
