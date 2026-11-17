// Jedyne miejsce, z którego kod osiągalny w grafie PRZEGLĄDARKI dociąga
// moduły server-only (`requestHost.server`, `ssrTiming.server`).
//
// Bramka `import.meta.env.SSR` przed dynamicznym `import()` nie wystarcza:
// bundler podglądu rozwiązuje specyfikatory przed eliminacją martwego kodu,
// więc import za wczesnym `return` nadal wciągał `@tanstack/react-start/server`
// i `src/lib/server/**` do bundla klienta, a import-protection odrzucał cały
// bundle (strony bez SSR, np. ekran zgody OAuth, w ogóle nie startowały).
// `createServerOnlyFn` jest przepisywany przez kompilator Start: na kliencie
// ciało (razem z `import()`) znika i zostaje funkcja rzucająca błąd, na
// serwerze zostaje dokładnie ten sam dynamiczny import co wcześniej.
//
// Wywołujący dalej trzymają własną bramkę SSR i try/catch - loader jest
// wyłącznie granicą bundla, nie zmienia żadnej decyzji w czasie wykonania.
import { createServerOnlyFn } from "@tanstack/react-start";

export const loadRequestHostServer = createServerOnlyFn(() => import("./requestHost.server"));

export const loadSsrTimingServer = createServerOnlyFn(() => import("./ssrTiming.server"));
