// Publiczny punkt wejścia kopii serwerowej zdarzeń piksela X (Conversion API).
// Wołany wyłącznie przez `xCapiMirror.ts` po zgodzie marketingowej; serwer
// sprawdza zgodę, pochodzenie i cel ponownie (`xCapi.server.ts`).
import { createServerFn } from "@tanstack/react-start";
import { XCapiBatchSchema } from "./xCapiSchema";

export const sendXCapiEvents = createServerFn({ method: "POST" })
  .validator((input: unknown) => XCapiBatchSchema.parse(input))
  .handler(async ({ data }) => {
    const { relayXCapiBatch } = await import("./xCapi.server");
    const result = await relayXCapiBatch(data);
    return { status: result.status };
  });
