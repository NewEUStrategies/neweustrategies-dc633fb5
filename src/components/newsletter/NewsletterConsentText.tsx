// Treści zgód (I9d-Y2, I9d-Y2b) jako elementy React - z JEDNEGO źródła
// odcinków (`@/lib/newsletter/consentText`, `@/lib/newsletter/measurementConsentText`),
// bez `innerHTML` i bez sanitizera. Formularze z polem wyboru pokazują treść
// pod etykietą, a jako dowód zapisują ten sam tekst w postaci HTML z wersją.
//
//   * `NewsletterConsentText` - zgoda na newsletter (wariant (b), bez pomiaru);
//   * `MeasurementConsentText` - OSOBNE pole zgody na pomiar otwarć i kliknięć
//     (`MeasurementConsentField`, karta decyzji na stronie potwierdzenia,
//     strona `/newsletter/measurement`);
//   * `ConsentSegmentsText` - wspólny render odcinków (tekst albo link).
//
// Linki otwierają się w nowej karcie: treść stoi w formularzu, a przejście
// w tej samej karcie kasowałoby wpisane dane. Kolor dziedziczony, podkreślenie
// odróżnia link od tekstu bez polegania na samym kolorze (WCAG 1.4.1).
import type { ConsentLang, ConsentSegment } from "@/lib/newsletter/consentSegments";
import { newsletterConsentSegments } from "@/lib/newsletter/consentText";
import { measurementConsentSegments } from "@/lib/newsletter/measurementConsentText";

export function ConsentSegmentsText({ segments }: { segments: readonly ConsentSegment[] }) {
  return (
    <>
      {segments.map((part, index) =>
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

export function NewsletterConsentText({ lang }: { lang: ConsentLang }) {
  return <ConsentSegmentsText segments={newsletterConsentSegments(lang)} />;
}

export function MeasurementConsentText({ lang }: { lang: ConsentLang }) {
  return <ConsentSegmentsText segments={measurementConsentSegments(lang)} />;
}
