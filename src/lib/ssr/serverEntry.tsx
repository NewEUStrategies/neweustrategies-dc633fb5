// Entry handlera TanStack Start - kopia domyślnego `@tanstack/react-start/server-entry`
// (node_modules/@tanstack/react-start/src/default-entry/server.ts) z jedną różnicą:
// własny handler strumienia, w którym decyzja „strumień czy `allReady`" zapada na
// UA emulowanej przeglądarki także dla Lighthouse'a/PSI (lib/http/lighthouseStreaming.ts).
// Render, `StartServer`, granica żądania (`createServerEntry`) i kontrakt
// `RequestHandler<Register>` są te same co w entry domyślnym.
//
// Ładowany leniwie z src/server.ts (`getServerEntry`) - tak jak wcześniej entry
// domyślne - żeby błąd inicjalizacji grafu aplikacji dało się złapać w try/catch.
import type { Register } from "@tanstack/react-router";
import { defineHandlerCallback, renderRouterToStream } from "@tanstack/react-router/ssr/server";
import {
  StartServer,
  createServerEntry,
  createStartHandler,
  type RequestHandler,
} from "@tanstack/react-start/server";

import { streamDecisionRequest } from "@/lib/http/lighthouseStreaming";

/** Ten sam kontrakt co `ServerEntry` entry domyślnego. */
export type ServerEntry = { fetch: RequestHandler<Register> };

/** `defaultStreamHandler` Startu z decyzją o strumieniu na UA przeglądarki. */
export const streamHandler = defineHandlerCallback(({ request, router, responseHeaders }) =>
  renderRouterToStream({
    request: streamDecisionRequest(request),
    router,
    responseHeaders,
    children: <StartServer router={router} />,
  }),
);

const entry: ServerEntry = createServerEntry<Register>({
  fetch: createStartHandler(streamHandler),
});

export default entry;
