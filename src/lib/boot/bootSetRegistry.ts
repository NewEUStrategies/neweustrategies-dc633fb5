// REJESTR ZESTAWU BOOTU PER ROUTER (P2.1). Zapisuje go serwer w haku dehydratacji routera
// (`bootSet.server.ts`, `prepareBootSet`), czyta węzeł danych w `<head>` (`bootSetNode.tsx`)
// w renderze tego samego żądania. Kluczem jest router: jeden na żądanie (`getRouter()`
// w `createStartHandler`), więc wpis jest zarazem strażnikiem „jeden węzeł na dokument",
// a WeakMap nie trzyma niczego dłużej niż sam router. Osobny plik, bo eksport funkcji z pliku
// komponentu psuje fast refresh (`react-refresh/only-export-components`); bez importów
// serwerowych - moduł jest w grafie przeglądarki razem z węzłem (tam nikt go nie zapisuje).

const bootSetJsonByRouter = new WeakMap<object, string>();

/** Serwer: escapowany JSON zestawu (`bootSetJson`) dla routera tego żądania. */
export function setBootSetJson(router: object, json: string): void {
  bootSetJsonByRouter.set(router, json);
}

/** JSON zestawu przygotowany dla routera albo `undefined` (dokument bez zestawu). */
export function getBootSetJson(router: object): string | undefined {
  return bootSetJsonByRouter.get(router);
}
