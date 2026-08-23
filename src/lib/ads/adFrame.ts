// Kontrakt izolacji ramki reklamowej: atrybut `sandbox` i dokument `srcdoc`.
//
// Wyjęte z `SandboxedAdFrame.tsx`, bo to jest GWARANCJA BEZPIECZEŃSTWA, a nie
// szczegół renderu: brak `allow-same-origin` sprawia, że kreacja dostaje
// opaque origin i nie widzi cookies, localStorage ani DOM strony czytelnika.
// Jako osobna stała da się to przypiąć testem, który padnie, gdy ktoś
// "naprawi" ramkę, dopisując `allow-same-origin`.
//
// Ciało buildera przeniesione ZNAK W ZNAK z komponentu.

/**
 * Lista uprawnień sandboxu kreacji. `allow-same-origin` NIE MOŻE się tu
 * pojawić - to jedyna rzecz, która trzyma stored XSS z panelu reklam z dala
 * od sesji czytelnika. `allow-popups-to-escape-sandbox` + `<base
 * target="_blank">` pozwalają linkom kreacji otworzyć się normalnie.
 */
export const AD_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/**
 * Dokument ramki. Markup kreacji trafia do `<body>` DOSŁOWNIE - żadnego
 * escapowania, bo to ma być wykonywalny HTML/JS, tylko w cudzym originie.
 */
export function buildAdFrameSrcDoc(markup: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    "<style>html,body{margin:0;padding:0;height:100%}" +
    "body{display:flex;align-items:center;justify-content:center;overflow:hidden}</style>" +
    `</head><body>${markup}</body></html>`
  );
}
