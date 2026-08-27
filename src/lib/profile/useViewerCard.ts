// FAKTY DO KARTY „KTO TO OGLĄDA" - jedno źródło dla strony i dla podglądu.
//
// PO CO OSOBNY HOOK, A NIE DWA WYWOŁANIA `useHeaderProfile`. Bo karta profilu
// widza stoi na wzorcu (zrzut 38) w lewej kolumnie strony wydarzenia i musi
// ją pokazać TAKŻE podgląd w studiu - a te dwa miejsca składają ją inaczej:
// strona publiczna daje odnośnik `<Link>` do `/profile/edit`, podgląd sam napis
// (klik wyprowadziłby redaktora ze studia z niezapisanym szkicem). Wspólne są
// dokładnie FAKTY: nazwa, stanowisko, organizacja, zdjęcie. Gdyby każde miejsce
// liczyło je po swojemu, ta sama osoba byłaby na jednej powierzchni „Igor
// Miasnikow", a na drugiej „office@..." - dokładnie ten rodzaj rozjazdu, który
// bramka `eventSpeakerFactParity` pilnuje dla prelegentów.
//
// ZAPYTANIE NIE JEST NOWE: siedzi pod tym samym kluczem, co pasek konta
// i powitanie (`useHeaderProfile`), więc karta nie dokłada round-tripu.
//
// PÓL, KTÓRYCH NIE MA, NIE ZGADUJEMY. `job_title` i `current_company` są
// w bazie opcjonalne i wracają tu PUSTYM NAPISEM, a nie zmyśloną wartością -
// o tym, czy linia w karcie istnieje, decyduje `EventViewerCard`.
import { useAuth } from "@/hooks/useAuth";
import { useHeaderProfile } from "@/lib/profile/useHeaderProfile";
import { profileDisplayName } from "@/lib/crm/profileSyncView";

export interface ViewerCardFacts {
  /** Nazwa wyświetlana, potem imię i nazwisko, potem e-mail - reguła z CRM-u. */
  name: string;
  /** `profiles.job_title` albo pusty napis. */
  jobTitle: string;
  /** `profiles.current_company` albo pusty napis. */
  company: string;
  /** `profiles.avatar_url` albo `null` (wtedy inicjały). */
  avatarUrl: string | null;
}

/**
 * Fakty o zalogowanym widzu albo `null`, gdy karty NIE MA CZEGO pokazać.
 *
 * `null` OZNACZA TRZY RÓŻNE STANY I TAK MA BYĆ - żaden z nich nie ma karty:
 * gość (brak sesji), wiersz profilu w drodze (karta pojawiłaby się na moment
 * z samym e-mailem, a potem urosła o dwie linie - skok układu obok banera)
 * i konto bez wiersza `profiles` (nie ma nawet nazwy, a karta z inicjałami „?"
 * nie mówi, czyj to profil).
 */
export function useViewerCardFacts(): ViewerCardFacts | null {
  const { user } = useAuth();
  const profileQuery = useHeaderProfile(user?.id);
  const profile = profileQuery.data ?? null;

  if (user === null || profileQuery.isPending) return null;

  const name = profileDisplayName({
    display_name: profile?.display_name,
    first_name: profile?.first_name,
    last_name: profile?.last_name,
    email: user.email,
  });
  if (name === "") return null;

  return {
    name,
    jobTitle: profile?.job_title ?? "",
    company: profile?.current_company ?? "",
    avatarUrl: profile?.avatar_url ?? null,
  };
}
