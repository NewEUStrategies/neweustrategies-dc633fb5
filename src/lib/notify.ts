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

function flush(): void {
  while (queue.length > 0) queue.shift()?.();
}

function withToast(run: (t: { success: ToastFn; error: ToastFn }) => void): void {
  if (typeof window === "undefined") return; // SSR: no-op
  if (toastModule) {
    run(toastModule);
    return;
  }
  queue.push(() => {
    if (toastModule) run(toastModule);
  });
  loading ??= import("sonner")
    .then((m) => {
      toastModule = m.toast;
      flush();
    })
    .catch(() => {
      // Chunk sonnera nie dojechał (sieć) - toasty są dekoracją, nie blokujemy.
      queue.length = 0;
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
