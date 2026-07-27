// Organizm: panel edytora wizualnego (Builder / "Elementor"). Trzyma lokalny
// wybór języka kanwy; treść wpina się do formularza przez `set`.
import { useState } from "react";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { useAdminLang } from "@/lib/builder/labelsEn";

export function BuilderPane({
  form,
  set,
}: {
  form: { builder_data: BuilderDocument | null };
  set: (k: "builder_data", v: BuilderDocument) => void;
}) {
  // Seed the canvas language from the admin UI language so an English admin
  // does not land on the Polish content tab (and Polish editor chrome).
  const adminLang = useAdminLang();
  const [lang, setLang] = useState<"pl" | "en">(adminLang);
  return (
    <Builder
      value={form.builder_data}
      onChange={(v) => set("builder_data", v)}
      lang={lang}
      onLangChange={setLang}
    />
  );
}
