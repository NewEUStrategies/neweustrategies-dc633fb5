// Zod schema mirroring src/lib/newsletter-builder/types.ts.
// Used server-side to validate saves and client-side to guard against
// corrupt documents (e.g. old legacy JSON). Discriminated union on `type`
// gives clear error messages per widget.
import { z } from "zod";

const NlI18n = z.object({
  pl: z.string().max(4000).default(""),
  en: z.string().max(4000).default(""),
});

const BaseWidget = { id: z.string().min(1).max(64), col: z.union([z.literal(0), z.literal(1)]).optional() };

export const NlWidgetSchema = z.discriminatedUnion("type", [
  z.object({
    ...BaseWidget,
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    text: NlI18n,
    align: z.enum(["left", "center", "right"]).optional(),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("paragraph"),
    html: NlI18n,
    size: z.enum(["sm", "md", "lg"]).optional(),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("image"),
    url: z.string().url().nullable(),
    alt: z.string().max(300).optional(),
    aspect: z.enum(["16/7", "16/9", "1/1", "4/3", "auto"]).optional(),
    rounded: z.boolean().optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("divider"),
    thickness: z.number().int().min(1).max(12).optional(),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("spacer"),
    size: z.number().int().min(2).max(240),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("field.email"),
    label: NlI18n,
    placeholder: NlI18n,
    required: z.literal(true).optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("field.text"),
    name: z.enum(["firstName", "lastName", "company", "position", "phone", "linkedin"]),
    label: NlI18n,
    placeholder: NlI18n,
    required: z.boolean().optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("field.checkbox"),
    key: z.string().min(1).max(64),
    html: NlI18n,
    required: z.boolean().optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("field.select"),
    name: z.string().min(1).max(64),
    label: NlI18n,
    placeholder: NlI18n,
    required: z.boolean().optional(),
    options: z
      .array(
        z.object({
          value: z.string().min(1).max(120),
          labelPl: z.string().max(200),
          labelEn: z.string().max(200),
        }),
      )
      .max(64),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("field.mailing-lists"),
    label: NlI18n,
    display: z.enum(["select", "checkboxes"]).optional(),
    required: z.boolean().optional(),
    listIds: z.array(z.string().max(64)).max(32).optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("submit"),
    label: NlI18n,
    fullWidth: z.boolean().optional(),
    bg: z.string().max(32).nullish(),
    fg: z.string().max(32).nullish(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("success-message"),
    text: NlI18n,
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("social-proof"),
    text: NlI18n,
    fallbackCount: z.number().int().min(0).max(10_000_000).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  }),
  z.object({
    ...BaseWidget,
    type: z.literal("countdown"),
    deadline: z.string().min(1).max(64),
    labelDays: NlI18n,
    labelHours: NlI18n,
    labelMinutes: NlI18n,
    labelSeconds: NlI18n,
    accent: z.string().max(32).nullish(),
  }),
]);

const NlSectionStyle = z.object({
  bg: z.string().max(64).nullish(),
  fg: z.string().max(64).nullish(),
  paddingY: z.number().int().min(0).max(240).optional(),
  paddingX: z.number().int().min(0).max(240).optional(),
  gap: z.number().int().min(0).max(120).optional(),
  radius: z.number().int().min(0).max(64).optional(),
  align: z.enum(["left", "center"]).optional(),
});

export const NlSectionSchema = z.object({
  id: z.string().min(1).max(64),
  widgets: z.array(NlWidgetSchema).max(64),
  style: NlSectionStyle.optional(),
  layout: z.enum(["single", "1-2", "1-1", "2-1"]).optional(),
});

export const NlDocSchema = z.object({
  version: z.literal(1),
  variant: z.enum(["inline", "popup"]),
  sections: z.array(NlSectionSchema).max(16),
  popup: z
    .object({
      bg: z.string().max(32).optional(),
      fg: z.string().max(32).optional(),
      muted: z.string().max(32).optional(),
      accent: z.string().max(32).optional(),
      accentFg: z.string().max(32).optional(),
      overlay: z.string().max(64).optional(),
      radius: z.number().int().min(0).max(64).optional(),
      layout: z.enum(["stacked", "split"]).optional(),
      sideImage: z.string().url().nullish(),
    })
    .optional(),
});

export type NlDocInput = z.input<typeof NlDocSchema>;
