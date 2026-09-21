// CZY TO WYWOŁANIE BIEGNIE W RENDERZE SERWEROWYM - jedno pytanie, jedna
// odpowiedź, liczona W CHWILI WYWOŁANIA.
//
// PO CO OSOBNY PREDYKAT, skoro `@tanstack/router-core/isServer` istnieje. Ta
// stała jest rozstrzygana WARUNKAMI EKSPORTU paczki w czasie budowania i ma
// wartość `undefined` zarówno w wariancie `development`, jak i pod
// `NODE_ENV=test` (router sięga wtedy po własną flagę, której prymityw spoza
// drzewa tras nie widzi). Modułowi `lib/ssr/*` potrzebna jest odpowiedź, która
// działa TAKŻE w teście - inaczej gałąź serwerowa albo przeglądarkowa staje się
// nietestowalna, a to dokładnie te dwie gałęzie, które chcemy udowodnić.
//
// `document` jest jedyną rzeczą, którą runtime dostarcza zawsze i jednoznacznie:
// istnieje w przeglądarce, nie istnieje w Node-owym renderze SSR.
//
// LICZONE PRZY KAŻDYM WYWOŁANIU, a nie raz przy imporcie. Stała modułowa
// zamrażałaby decyzję na chwilę pierwszego importu - w teście na chwilę
// załadowania pliku - więc żaden stub środowiska nie miałby już czego
// przestawić, a oba warianty zachowania musiałyby być brane na wiarę.
export function isSsrRequest(): boolean {
  return typeof document === "undefined";
}
