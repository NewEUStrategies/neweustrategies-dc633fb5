// Publiczny punkt wejścia kopii serwerowej zdarzeń piksela Meta (CAPI).
// Wołany wyłącznie przez `metaCapiMirror.ts` po zgodzie marketingowej; serwer
// sprawdza zgodę, pochodzenie i cel ponownie (`metaCapi.server.ts`).
import { createServerFn } from "@tanstack/react-start";
import { MetaCapiBatchSchema } from "./metaCapiSchema";

export const sendMetaCapiEvents = createServerFn({ method: "POST" })
  .validator((input: unknown) => MetaCapiBatchSchema.parse(input))
  .handler(async ({ data }) => {
    const { relayMetaCapiBatch } = await import("./metaCapi.server");
    const result = await relayMetaCapiBatch(data);
    return { status: result.status };
  });
