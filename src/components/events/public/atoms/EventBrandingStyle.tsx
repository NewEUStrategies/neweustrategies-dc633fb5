// Atom: branding jednego wydarzenia jako zmienne CSS.
//
// TEN SAM WZORZEC, CO MOTYW GLOBALNY, NIE DRUGI MECHANIZM. `DesignTokensStyle`
// składa CSS napisem (`globalColorsToCss`), przepuszcza go przez
// `hardenStyleCss` i wstawia jednym `<style dangerouslySetInnerHTML>`. Tutaj
// jest dokładnie to samo, tylko z innym selektorem - drugi sposób wstrzykiwania
// kolorów w jednym repozytorium znaczyłby dwa miejsca, w których trzeba
// pamiętać o utwardzeniu napisu. Regułę (zakres, mapowanie slotów na tokeny,
// pomijanie pustych slotów) liczy `lib/events/eventBrandingCss` - ten plik
// wyłącznie ją montuje.
//
// SSR-SAFE. Komponent nie dotyka `document`, `window` ani `useEffect` - to
// czysta droga z JSON-a do `<style>`, więc serwer renderuje kolory razem
// z markupem i strona nie miga domyślnym motywem przed hydratacją.
import { hardenStyleCss } from "@/lib/sanitizePure";
import { eventBrandingCss } from "@/lib/events/eventBrandingCss";

export function EventBrandingStyle({ branding }: { branding: unknown }) {
  const css = eventBrandingCss(branding);
  if (css === "") return null;
  // Wartości pochodzą z kolumny `jsonb`, więc utwardzamy napis dokładnie jak
  // `DesignTokensStyle`: wstrzyknięty `</style>` nie może wyjść do HTML-a.
  return (
    <style data-event-branding-tokens dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />
  );
}
