// Powierzchnia 404 trasy `/` (notFoundComponent).
//
// Tekst ze słownika `lib/errorCopy.ts` - patrz `HomeErrorNotice`: warstwa
// awaryjna czyta dwujęzyczny słownik, bo renderuje się poza dostawcą i18next.
// Bez przycisku „spróbuj ponownie": ponowienie żądania nie zmieni tego, że
// zasobu nie ma - jedyne sensowne wyjście to strona główna.
import { errorCopy } from "@/lib/errorCopy";

export function HomeNotFoundNotice() {
  const copy = errorCopy();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {copy.notFoundTitle}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {copy.goHome}
        </a>
      </div>
    </div>
  );
}
