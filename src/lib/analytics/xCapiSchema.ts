// Walidacja wejścia kopii serwerowej zdarzeń piksela X - tylko granica
// serwera (`xCapi.functions.ts`). Kontrakt i reguły: `xCapiContract.ts`.
import { z } from "zod";
import {
  X_CAPI_MAX_BATCH,
  X_CONVERSION_ID_RE,
  X_EVENT_ID_RE,
  X_TWCLID_RE,
  type XCapiBatch,
} from "./xCapiContract";

export const XCapiEventSchema = z
  .object({
    event_id: z.string().regex(X_EVENT_ID_RE),
    conversion_id: z.string().regex(X_CONVERSION_ID_RE),
    occurred_at: z.number().int().positive(),
    event_source_url: z.string().url().max(2048),
    value: z.number().finite().min(0).max(10_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

export const XCapiBatchSchema: z.ZodType<XCapiBatch> = z
  .object({
    events: z.array(XCapiEventSchema).min(1).max(X_CAPI_MAX_BATCH),
    twclid: z.string().regex(X_TWCLID_RE).optional(),
  })
  .strict();
