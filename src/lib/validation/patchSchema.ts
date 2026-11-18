import { z } from "zod";

/**
 * Schemat ŁATKI (częściowej aktualizacji) z schematu tworzenia: każde pole
 * opcjonalne, a pominięte pole ZOSTAJE pominięte.
 *
 * Dlaczego nie samo `.partial()`: od Zod 4 `optional(default(x))` dla
 * brakującego klucza zwraca `x` (Zod 3 zwracał `undefined`). Schemat tworzenia
 * z `status.default("draft")` czy `title_pl.default("")` po `.partial()`
 * dopisywałby więc do KAŻDEGO autozapisu `status: "draft"` i puste tytuły -
 * cicho zdejmując publikację i kasując treść. Tu domyślki najwyższego poziomu
 * są zdejmowane przed `optional`, więc łatka niesie wyłącznie to, co przysłał
 * klient. Zagnieżdżone obiekty zachowują swoje domyślki (klient przysyła je w
 * całości). Konfiguracja obiektu (strip/strict/catchall) zostaje zachowana.
 */
type WithoutDefault<T extends z.core.SomeType> =
  T extends z.ZodDefault<infer Inner extends z.core.SomeType> ? Inner : T;

export type PatchShape<S extends z.ZodRawShape> = {
  -readonly [K in keyof S]: z.ZodOptional<WithoutDefault<S[K]>>;
};

export function patchSchema<S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.core.SomeType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = z.optional(inner);
  }
  // `extend` zachowuje konfigurację obiektu; typ kształtu liczy `PatchShape`.
  return schema.extend(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
