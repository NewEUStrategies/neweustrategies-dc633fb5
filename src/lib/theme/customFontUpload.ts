// Wgrywanie własnego fontu marki do koszyka `media` (`<tenantId>/fonts/*`) -
// część PANELU (`CustomFontUploader` w ustawieniach wyglądu). Model wpisu
// i reguły `@font-face` opisuje `customFonts.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `customFonts.ts` importuje `designTokens.ts`, więc siedzi w `app-initial`;
// wgrywanie (ok. 0,9 KB surowego kodu) woła wyłącznie panel.
// `customFonts.ts` NIE importuje stąd niczego - także reeksportem.
import { supabase } from "@/integrations/supabase/client";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import { notifyError } from "@/lib/notify";
import type { CustomFont } from "./customFonts";

export function slugifyFontName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "font"
  );
}

const ALLOWED_EXT = new Set(["woff2", "woff", "ttf", "otf"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function uploadCustomFont(opts: {
  file: File;
  label: string;
  tenantId: string;
  weight?: string;
  style?: "normal" | "italic";
}): Promise<CustomFont | null> {
  const ext = opts.file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    notifyError("Dozwolone formaty: .woff2, .woff, .ttf, .otf");
    return null;
  }
  if (opts.file.size > MAX_BYTES) {
    notifyError("Plik fontu jest większy niż 5 MB");
    return null;
  }
  const id = slugifyFontName(opts.label || opts.file.name.replace(/\.[^.]+$/, ""));
  const path = `${opts.tenantId}/fonts/${id}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, opts.file, {
    contentType: opts.file.type || `font/${ext === "ttf" ? "ttf" : ext}`,
    cacheControl: "31536000, immutable",
    upsert: false,
  });
  if (error) {
    notifyError(error.message || "Nie udało się wysłać fontu");
    return null;
  }
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return {
    id,
    label: opts.label || id,
    url: brandedMediaUrl(data.publicUrl),
    weight: opts.weight ?? "400",
    style: opts.style ?? "normal",
    display: "swap",
  };
}
