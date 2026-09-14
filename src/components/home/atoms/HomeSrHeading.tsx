// Nagłówek H1 strony głównej.
//
// INWARIANT: dokładnie JEDEN `h1` na stronie. Bezwarunkowy `h1` dawał DWA
// nagłówki poziomu 1 na kanwie, która sama renderuje nagłówek (ten sam defekt
// co na stronach buildera - audyt 2026-08-06, korekta 2), więc render tego
// nagłówka zależy od `builderDocHasTopHeading`.
//
// WIDOCZNOŚĆ (2026-09-14, wniosek skanera treści SEO): nagłówek był `sr-only`,
// więc strona główna nie miała ŻADNEGO widocznego nagłówka głównego - ani dla
// czytelnika, ani dla wyszukiwarki, która widoczność nagłówka traktuje jako
// sygnał tematu strony. Teraz nagłówek jest widoczny (dyskretny pasek nad
// treścią kanwy) - dopóki redakcja nie zaprojektuje własnego `h1` w builderze,
// wtedy ten w ogóle się nie renderuje.
//
// DŁUG I18N (świadomie ZACHOWANY, nie naprawiony w tym pliku): tekst nagłówka
// jest dwujęzycznym LITERAŁEM w kodzie, a nie kluczem słownika - dokładnie tak,
// jak stał w `routes/index.tsx`. Przeniesienie go do słownika zmienia treść
// najważniejszego nagłówka SEO serwisu i wymaga decyzji, do KTÓREGO bundle'a
// i18n klucz trafia (strona główna nie woła żadnego `ensureI18n`), dlatego
// defekt jest UDOKUMENTOWANY testem `it.fails` w
// `src/routes/__tests__/homeRoute.test.tsx`, a nie cicho przepisany.
import { builderDocHasTopHeading } from "@/lib/builder/headings";
import type { BuilderDocument } from "@/lib/builder/types";

export function HomeSrHeading({ doc, lang }: { doc: BuilderDocument | null; lang: "pl" | "en" }) {
  if (builderDocHasTopHeading(doc)) return null;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
      <h1 className="font-display text-xl font-semibold leading-snug text-foreground sm:text-2xl">
        {lang === "en"
          ? "New European Strategies - Strategic thinking, new perspectives"
          : "New European Strategies - Strategiczne myślenie, nowe perspektywy"}
      </h1>
    </div>
  );
}
