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

export interface HomeErrorNoticeProps {
  onRetry: () => void;
  /**
   * Nazwa serwisu - jedyny `h1` tej powierzchni (patrz `homeSrHeadingText`).
   *
   * Komunikat awarii NIE jest nagłówkiem z tego samego powodu co komunikat
   * wczytywania (`HomeLoadingNotice`, zgłoszenie 2026-10-09): `errorComponent`
   * zastępuje całą trasę, więc `h1` z treścią „Nie udało się załadować
   * strony" byłby najwidoczniejszym tekstem adresu "/" - a Google wybiera tytuł
   * wyniku także z nagłówków. `data-nosnippet` chroni wyłącznie fragment
   * wyniku, nie tytuł.
   */
  brand: string;
}

export function HomeErrorNotice({ onRetry, brand }: HomeErrorNoticeProps) {
  const copy = errorCopy();
  return (
    // `data-nosnippet`: tekst awarii nie może trafić do fragmentu wyniku na
    // nazwę marki. Celowo BEZ `noindex` (por. `useErrorNoindex`) - wypadnięcie
    // adresu "/" z indeksu po jednym nieudanym renderze kosztowałoby więcej
    // niż chwilowo gorszy wynik.
    <div
      data-nosnippet
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {brand}
        </h1>
        <p role="alert" className="mt-4 text-xl font-semibold tracking-tight text-foreground">
          {copy.errorTitle}
        </p>
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
