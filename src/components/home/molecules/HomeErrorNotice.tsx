// Powierzchnia AWARII strony głównej (errorComponent trasy `/`).
//
// TEKST IDZIE ZE SŁOWNIKA `lib/errorCopy.ts` - dwujęzyczny `Record<"pl"|"en">`
// czytany przez `currentLang()`, a nie przez i18next. To ŚWIADOMA decyzja repo,
// nie dług: warstwa awaryjna renderuje się także POZA dostawcą i18next (granica
// błędu korzenia), więc `useTranslation()` nie jest tu dostępny.
//
// Sam błąd NIE jest pokazywany czytelnikowi (`error.message` bywa techniczny
// i bywa wyciekiem) - trafia do konsoli po stronie wywołującej granicy.
import { errorCopy } from "@/lib/errorCopy";

export function HomeErrorNotice({ onRetry }: { onRetry: () => void }) {
  const copy = errorCopy();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.errorTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.errorBody}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copy.tryAgain}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {copy.goHome}
          </a>
        </div>
      </div>
    </div>
  );
}
