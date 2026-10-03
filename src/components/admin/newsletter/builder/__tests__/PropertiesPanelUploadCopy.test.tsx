// Pole obrazu buildera newslettera (`ImageUrlField` w `PropertiesPanel`) a wspólny
// słownik obszaru wgrywania (`uploadArea.*`).
//
// Zdanie o przeciąganiu obrazu stoi na każdej powierzchni z `UploadArea`
// (okładka wpisu, slot obrazu buildera stron, profil autora) i pochodzi z JEDNEGO
// klucza: `uploadArea.image.description`. Migracja panelu na `UploadArea`
// wpisała je drugi raz, warunkiem po języku - poprawka redakcyjna w słowniku
// zmieniała wtedy wszystkie powierzchnie poza tą jedną.
//
// DRUGI KONTRAKT: builder newslettera mówi JĘZYKIEM EDYTOWANEJ WERSJI (`lang`
// z przełącznika PL/EN buildera), nie językiem interfejsu - cały panel jest tak
// zbudowany. Klucz ze słownika nie może tego zmienić: przy interfejsie po
// polsku i wersji EN zdanie ma być angielskie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-1",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => ({}),
}));
vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: {} }));
// Biblioteka mediów ma własne testy - i to ona do tej pory wciągała nakładkę
// `uploadArea` pośrednio. Atrapa odcina tę drogę: słownik musi przyjść z
// importu samego panelu (bramka `check:i18n-overlay-imports`).
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.test/x.png" } }),
      }),
    },
  },
}));

import i18n from "@/lib/i18n";
import { PropertiesPanel } from "@/components/admin/newsletter/builder/PropertiesPanel";
import { buildDefaultDoc, makeSection } from "@/lib/newsletter-builder/defaults";

const KEY = "uploadArea.image.description";

function mountSection(lang: "pl" | "en") {
  render(
    <PropertiesPanel
      variant="inline"
      doc={buildDefaultDoc("inline")}
      selected={null}
      selectedSection={makeSection([])}
      lang={lang}
      onPatch={vi.fn()}
      onPatchPopup={vi.fn()}
      onPatchSection={vi.fn()}
      onPatchLayout={vi.fn()}
      onPatchSectionMedia={vi.fn()}
    />,
  );
}

function setDescription(lang: "pl" | "en", text: string | undefined): void {
  if (text === undefined) return;
  i18n.addResourceBundle(
    lang,
    "translation",
    { uploadArea: { image: { description: text } } },
    true,
    true,
  );
}

let original: Record<"pl" | "en", string | undefined> = { pl: undefined, en: undefined };

beforeEach(() => {
  original = {
    pl: i18n.getResource("pl", "translation", KEY) as string | undefined,
    en: i18n.getResource("en", "translation", KEY) as string | undefined,
  };
});

afterEach(() => {
  cleanup();
  setDescription("pl", original.pl);
  setDescription("en", original.en);
});

describe("PropertiesPanel - opis pola obrazu ze wspólnego słownika", () => {
  it("panel sam rejestruje nakładkę `uploadArea` - zdanie jest w słowniku obu języków", () => {
    expect(original.pl).toBe("Przeciągnij obraz tutaj albo wybierz go z dysku.");
    expect(original.en).toBe("Drag an image here, or pick one from your disk.");
  });

  it.each(["pl", "en"] as const)(
    "%s: opis pochodzi z `uploadArea.image.description` - poprawka w słowniku dociera do panelu",
    (lang) => {
      setDescription(lang, `[${lang}] zdanie ze słownika`);
      mountSection(lang);
      expect(screen.getByText(`[${lang}] zdanie ze słownika`)).toBeTruthy();
    },
  );

  it("język EDYTOWANEJ wersji wygrywa z językiem interfejsu", () => {
    expect(i18n.language).toBe("pl");
    mountSection("en");
    expect(screen.getByText("Drag an image here, or pick one from your disk.")).toBeTruthy();
    expect(screen.queryByText("Przeciągnij obraz tutaj albo wybierz go z dysku.")).toBeNull();
  });

  it("pozostałe etykiety pola zostają przy języku edytowanej wersji", () => {
    mountSection("pl");
    expect(screen.getByText("Przeciągnij obraz tutaj albo wybierz go z dysku.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wgraj" })).toBeTruthy();
    expect(screen.getByLabelText("Wgraj z dysku")).toBeTruthy();
  });
});
