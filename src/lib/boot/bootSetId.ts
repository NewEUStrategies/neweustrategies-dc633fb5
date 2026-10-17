// Id węzła zestawu bootu (P2.1) w osobnym module bez zależności: czytają go węzeł danych
// (`bootSetNode.tsx`, w grafie przeglądarki) i loader (`bootLoaderScript.ts`, wyłącznie gałęzie
// serwerowe). Import z modułu loadera wciągnąłby do bundla klienta literał `BOOT_LOADER_SCRIPT`
// (doktryna przy `bootLoaderScript` w `routes/__root.tsx`).

/** Id węzła zestawu bootu - kontrakt z `bootSetNode.tsx`, loaderem, e2e i `documentWeight.ts`. */
export const BOOT_SET_ELEMENT_ID = "nes-boot-set";
