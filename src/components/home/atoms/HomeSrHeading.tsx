// Nagłówek H1 strony głównej dla czytników ekranu.
//
// INWARIANT: dokładnie JEDEN `h1` na stronie. Bezwarunkowy `h1` dawał DWA
// nagłówki poziomu 1 na kanwie, która sama renderuje nagłówek (ten sam defekt
// co na stronach buildera - audyt 2026-08-06, korekta 2), więc widoczność tego
// nagłówka zależy od `builderDocHasTopHeading`.
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
    <h1 className="sr-only">
      {lang === "en"
        ? "New European Strategies - Strategic thinking, new perspectives"
        : "New European Strategies - Strategiczne myślenie, nowe perspektywy"}
    </h1>
  );
}
