// Wartości filtrów PostgREST budowanych RĘCZNIE (`.or("kol.op.wartość,...")`)
// tak, żeby żaden znak wartości nie zmienił znaczenia filtra.
//
// DLACZEGO OSOBNY MODUŁ. `escapeLike` (lib/admin/listFilters.ts) USUWA znaki
// `% _ * , ( ) " \` - to dobre dla frazy wyszukiwania („zawiera"), ale zabójcze
// dla RÓWNOŚCI: z `jan_kowalski@x.pl` robi `jankowalski@x.pl`, czyli adres
// INNEJ osoby. Tu nic nie wylatuje: każdy znak jest cytowany albo escapowany,
// a wartości, których nie da się wyrazić bez wieloznacznika, są ODRZUCANE.
//
// REGUŁY - zweryfikowane w źródłach, nie z pamięci (listopad 2026):
//
// 1. Cytowanie w drzewie logicznym (`or=(...)`) i w liście `in.(...)`.
//    Dokumentacja PostgREST, „URL Grammar → Reserved characters"
//    (docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters):
//    wartość ze znakiem zastrzeżonym (`,` `.` `:` `*` `(` `)`) ujmuje się
//    w cudzysłów `"`; cudzysłów wewnątrz to `\"`, ukośnik wsteczny to `\\`.
//    Parser (src/library/PostgREST/ApiRequest/QueryParams.hs, identyczny
//    w v12.2.3, v14.18 i main@b7b3336):
//      pQuotedValue    = char '"' *> many (noneOf "\\\"" <|> (char '\\' *> anyChar)) <* char '"'
//      pLogicSingleVal = try (pQuotedValue <* notFollowedBy (noneOf ",)")) <|> ...
//      pListElement    = try (pQuotedValue <* notFollowedBy (noneOf ",)")) <|> ...
//    Czyli: wewnątrz cudzysłowu `\x` daje `x` dla DOWOLNEGO `x`, a po
//    zamykającym `"` musi stać `,` albo `)`. Wartość w cudzysłowie z `\\`
//    i `\"` przechodzi więc dosłownie - przecinek, kropka, dwukropek
//    i nawiasy nie rozcinają filtra.
//
// 2. `*` w `like`/`ilike` jest ZAWSZE `%`. Dokumentacja („Tables and Views →
//    Operators": „you can use * as an alias of the percent sign %") i źródło
//    (src/library/PostgREST/Query/SqlFragment.hs, `pgFmtFilter`):
//      OpILike -> fmtQuant quant $ unknownLiteral (T.map star val)
//      star c = if c == '*' then '%' else c
//    Zamiana działa na wartości JUŻ po zdjęciu cytowania i bez wyjątków - `\*`
//    staje się `\%` (dosłowny procent), nie gwiazdką. Gwiazdki we wzorcu LIKE
//    nie da się więc wyrazić wcale: wartość z `*` NIE MOŻE iść ścieżką `ilike`.
//
// 3. postgrest-js NICZEGO tu nie escapuje. `.or(filters)` dokleja
//    `(${filters})` jako parametr `or` (PostgrestFilterBuilder.or,
//    @supabase/postgrest-js 2.x w node_modules), a `.in()` cytuje tylko
//    wartości z `[,()]` i nie escapuje w nich `"` ani `\`. Kodowanie URL robi
//    `URLSearchParams` - ono chroni transport, nie gramatykę filtra.
//
// 4. Wzorzec LIKE w PostgreSQL (dokumentacja „9.7.1. LIKE"): `_` to dowolny
//    znak, `%` dowolny ciąg, domyślnym znakiem ucieczki jest `\`. PostgREST
//    przekazuje wzorzec jako parametr (`unknownLiteral`), więc `\` dociera do
//    LIKE dosłownie. Równość bez wielkości liter = `ILIKE` wzorca, w którym
//    `\`, `%` i `_` poprzedza `\` (ukośnik NAJPIERW - inaczej zdublowalibyśmy
//    ukośniki dodane przed `%`/`_`). Semantykę sprawdzono na lokalnym PG16.

/** PostgREST zamienia `*` na `%` we wzorcach like/ilike - bez wyjątków (reguła 2). */
const LIKE_STAR = "*";

/**
 * Wartość w cudzysłowie PostgREST: `"..."` z `\` i `"` poprzedzonymi `\`
 * (reguła 1). Bezpieczna w drzewie `or=(...)` i w liście `in.(...)`.
 */
export function postgrestQuoted(value: string): string {
  return `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

/** Lista `in.(...)` (bez nawiasów) - każda wartość cytowana jak wyżej. */
export function postgrestQuotedList(values: readonly string[]): string {
  return values.map(postgrestQuoted).join(",");
}

/**
 * Czy wartość da się porównać `ilike` bez wieloznacznika. Fałsz dla `*`:
 * PostgREST i tak zrobiłby z niej `%` (reguła 2) - taka wartość idzie
 * porównaniem dokładnym.
 */
export function ilikeEqualityExpressible(value: string): boolean {
  return !value.includes(LIKE_STAR);
}

/**
 * Wzorzec LIKE dopasowujący DOKŁADNIE `value` (reguła 4): `\`, potem `%`
 * i `_` poprzedzone `\`. Rzuca dla `*` - wzorzec po stronie PostgREST
 * miałby wieloznacznik, którego nie da się wyłączyć.
 */
export function likeLiteral(value: string): string {
  if (!ilikeEqualityExpressible(value)) {
    throw new Error("likeLiteral: `*` nie ma dosłownej postaci we wzorcu PostgREST like/ilike");
  }
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Operand `kol.ilike.<operand>` dający RÓWNOŚĆ bez wielkości liter:
 * wzorzec bez wieloznaczników (`likeLiteral`) w cudzysłowie PostgREST.
 */
export function ilikeEqualsOperand(value: string): string {
  return postgrestQuoted(likeLiteral(value));
}

/**
 * Długość wartości parametru po kodowaniu, jakie robi postgrest-js
 * (`URL.searchParams.append` -> `application/x-www-form-urlencoded`).
 * Służy do porcjowania filtrów, które jadą w adresie URL zapytania.
 */
export function urlEncodedLength(value: string): number {
  return new URLSearchParams([["", value]]).toString().length - 1;
}
