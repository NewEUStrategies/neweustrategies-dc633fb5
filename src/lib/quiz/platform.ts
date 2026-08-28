// Stale landingu /quiz.
//
// Musza mieszkac POZA plikiem trasy: rozdzielacz tras TanStack przenosi kod
// komponentu do osobnego kawalka i re-eksportuje wartosci modulowe uzywane po
// obu stronach granicy (`head()` i komponent). Stala w pliku trasy konczyla sie
// bledem „does not provide an export named 'QUIZ_PLATFORM_URL'", ktory wywracal
// bundle kliencki i zostawial caly serwis bez hydracji.

/** Druga platforma NES, ktora ten landing promuje (cross-promo EuroChallenge). */
export const QUIZ_PLATFORM_URL = "https://nes-quiz.com";
/** Ten sam quiz bez wlasnego chrome'u - wersja do osadzenia w iframe. */
export const QUIZ_EMBED_URL = `${QUIZ_PLATFORM_URL}/embed`;
export const QUIZ_TITLE = "EuroChallenge Quiz";
