// Organizm: panel edytora wizualnego (Builder / "Elementor"). Trzyma lokalny
// wybór języka kanwy; treść wpina się do formularza przez `set`.
import { useState } from "react";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";

export function BuilderPane({
  form,
  set,
}: {
  form: { builder_data: BuilderDocument | null };
  set: (k: "builder_data", v: BuilderDocument) => void;
}) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return (
    <Builder
      value={form.builder_data}
      onChange={(v) => set("builder_data", v)}
      lang={lang}
      onLangChange={setLang}
    />
  );
}
