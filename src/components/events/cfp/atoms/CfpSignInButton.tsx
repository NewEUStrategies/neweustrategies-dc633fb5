// Atom: „Zaloguj się" na powierzchniach naboru, które bez konta nie mają treści
// (formularz zgłoszenia, panel prelegenta, panel recenzenta, strona naboru).
//
// OKNO LOGOWANIA APLIKACJI, NIE PRZEKIEROWANIE. Szyna `loginPopupBus` otwiera
// wspólne okno z kontekstem (tytuł i opis mówią, PO CO logowanie), a po
// zalogowaniu uczestnik zostaje na tej samej stronie - sesja zmienia się
// w `useAuth` i powierzchnia sama się przerysowuje. Przekierowanie na
// `/login` gubiło `?id=` szkicu i kontekst wydarzenia.
import { Button } from "@/components/ui/button";
import { openLoginPopup } from "@/lib/loginPopupBus";

export function CfpSignInButton({
  label,
  title,
  description,
}: {
  /** Gotowy napis przycisku (wywołujący zna kontekst). */
  label: string;
  /** Tytuł i opis okna logowania - dlaczego się pojawiło. */
  title: string;
  description: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => openLoginPopup({ mode: "signin", title, description })}
    >
      {label}
    </Button>
  );
}
