// Domyślna treść zgody na newsletter (I9d-Y2) jako elementy React - z JEDNEGO
// źródła (`@/lib/newsletter/consentText`), bez `innerHTML` i bez sanitizera:
// formularze z polem wyboru (rejestracja, bramka klubu, kontakt, popup,
// „Dołącz do nas") pokazują ją pod etykietą, a jako dowód zapisują ten sam
// tekst w postaci HTML z wersją.
//
// Linki otwierają się w nowej karcie: treść stoi w formularzu, a przejście
// w tej samej karcie kasowałoby wpisane dane. Kolor dziedziczony, podkreślenie
// odróżnia link od tekstu bez polegania na samym kolorze (WCAG 1.4.1).
import { newsletterConsentSegments, type ConsentLang } from "@/lib/newsletter/consentText";

export function NewsletterConsentText({ lang }: { lang: ConsentLang }) {
  return (
    <>
      {newsletterConsentSegments(lang).map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {part.label}
          </a>
        ),
      )}
    </>
  );
}
