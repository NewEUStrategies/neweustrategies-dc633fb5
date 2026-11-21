// Walidacja wejścia kopii serwerowej zdarzeń piksela Meta (CAPI) - tylko
// granica serwera (`metaCapi.functions.ts`). Kontrakt i reguły: `metaCapiContract.ts`.
import { z } from "zod";
import {
  META_CAPI_MAX_BATCH,
  META_EVENT_ID_RE,
  META_FBC_RE,
  META_FBP_RE,
  META_STANDARD_EVENTS,
} from "./metaCapiContract";

const MAX_TEXT = 100;
const text = z.string().trim().min(1).max(MAX_TEXT);

export const MetaCapiCustomDataSchema = z
  .object({
    value: z.number().finite().min(0).max(10_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    content_ids: z.array(text).max(20).optional(),
    content_category: text.optional(),
    content_type: z.enum(["product", "product_group"]).optional(),
    contents: z
      .array(z.object({ id: text, quantity: z.number().int().min(1).max(1_000) }).strict())
      .max(20)
      .optional(),
    predicted_ltv: z.number().finite().min(0).max(10_000_000).optional(),
    num_items: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();

export type MetaCapiCustomData = z.infer<typeof MetaCapiCustomDataSchema>;

export const MetaCapiEventSchema = z
  .object({
    event_name: z.enum(META_STANDARD_EVENTS),
    event_id: z.string().regex(META_EVENT_ID_RE),
    /** Unix w sekundach - moment zdarzenia w przeglądarce (nie moment wysyłki). */
    event_time: z.number().int().positive(),
    event_source_url: z.string().url().max(2048),
    custom_data: MetaCapiCustomDataSchema.optional(),
  })
  .strict();

export type MetaCapiEvent = z.infer<typeof MetaCapiEventSchema>;

export const MetaCapiBatchSchema = z
  .object({
    events: z.array(MetaCapiEventSchema).min(1).max(META_CAPI_MAX_BATCH),
    fbp: z.string().regex(META_FBP_RE).optional(),
    fbc: z.string().regex(META_FBC_RE).optional(),
  })
  .strict();

export type MetaCapiBatch = z.infer<typeof MetaCapiBatchSchema>;

