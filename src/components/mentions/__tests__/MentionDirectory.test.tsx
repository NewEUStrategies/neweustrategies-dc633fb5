// Katalog wzmianek w drzewie - `MentionDirectoryProvider` i `useMentionEntity`.
//
// CO TEN PLIK DOWODZI.
// (1) BRAK DOSTAWCY NIE JEST BŁĘDEM. Poza dostawcą (izolowany render w teście,
//     podgląd komponentu, wzmianka w miejscu, którego nikt nie owinął) hak
//     oddaje `null`, a nie rzuca. Wzmianka schodzi wtedy na uczytelniony slug
//     i leniwy dymek - nick nie pojawia się nawet w tym stanie.
// (2) Z DOSTAWCĄ hak czyta z mapy powierzchni, a nie ze swojego zapytania - to
//     jest cały sens zbiorczego rozwiązywania: JEDNO wyjście do bazy na
//     powierzchnię zamiast jednego na wzmiankę.
// (3) SLUG JEST NORMALIZOWANY DO MAŁYCH LITER przy odczycie. Autor pisze
//     `@Anna-Nowak`, baza i katalog trzymają `anna-nowak`; brak normalizacji
//     daje „nierozwiązaną" wzmiankę osoby, która JEST w katalogu - a objaw
//     (uczytelniony slug) wygląda dokładnie jak poprawny stan zastępczy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) ZAPYTANIA `useMentionDirectory` (dwa kroki, limit slugów, klucz cache) -
//     tu jest atrapą; testujemy PRZEKAZANIE mapy w dół, nie jej pobranie.
// (b) BUDOWY KATALOGU (`buildDirectory`, pierwszeństwo osoby przed organizacją,
//     mapowanie wierszy) - warstwa czysta ma własną suitę `directory.test.ts`.
// (c) WYGLĄDU WZMIANKI korzystającej z katalogu - to `MentionTag.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import type { MentionDirectory, MentionEntity } from "@/lib/mentions/directory";

const state = vi.hoisted(() => ({
  directory: new Map<string, unknown>() as Map<string, unknown>,
  calls: [] as Array<{ slugs: readonly string[]; lang: string }>,
}));

vi.mock("@/lib/mentions/useMentionDirectory", () => ({
  useMentionDirectory: (slugs: readonly string[], lang: string) => {
    state.calls.push({ slugs, lang });
    return { directory: state.directory as unknown as MentionDirectory, isPending: false };
  },
}));

import { MentionDirectoryProvider, useMentionEntity } from "@/components/mentions/MentionDirectory";

const ANNA: MentionEntity = {
  kind: "person",
  slug: "anna-nowak",
  name: "Anna Nowak",
  avatarUrl: null,
  jobTitle: null,
  company: null,
  bio: null,
  verified: false,
};

const ACME: MentionEntity = {
  kind: "org",
  slug: "acme",
  id: "org-1",
  name: "ACME Polska",
  logoUrl: null,
  description: null,
};

/** Dostawca z podstawioną mapą - powierzchnia „już rozwiązała" te slugi. */
function withProvider(slugs: readonly string[] = ["anna-nowak", "acme"], lang: "pl" | "en" = "pl") {
  return ({ children }: { children: ReactNode }) => (
    <MentionDirectoryProvider slugs={slugs} lang={lang}>
      {children}
    </MentionDirectoryProvider>
  );
}

beforeEach(() => {
  state.directory = new Map<string, unknown>([
    ["anna-nowak", ANNA],
    ["acme", ACME],
  ]);
  state.calls = [];
});

describe("useMentionEntity - bez dostawcy", () => {
  it("oddaje `null` zamiast rzucać", () => {
    // Regresja, którą to łapie: wymuszenie dostawcy wyjątkiem. Wzmianka bywa
    // renderowana poza powierzchnią (podgląd komponentu, wiadomość w widgecie),
    // a wysypanie atomu zabiera całą trasę przez ErrorBoundary.
    const { result } = renderHook(() => useMentionEntity("anna-nowak"));

    expect(result.current).toBeNull();
  });
});

describe("useMentionEntity - z dostawcą", () => {
  it("oddaje byt spod sluga", () => {
    const { result } = renderHook(() => useMentionEntity("anna-nowak"), {
      wrapper: withProvider(),
    });

    expect(result.current).toEqual(ANNA);
  });

  it("slug spoza katalogu to `null`, a nie błąd", () => {
    const { result } = renderHook(() => useMentionEntity("jan-kowalski"), {
      wrapper: withProvider(),
    });

    expect(result.current).toBeNull();
  });

  it.each([
    ["Anna-Nowak", "pisownia autora z wielkich liter"],
    ["ANNA-NOWAK", "wersaliki"],
  ])("slug %s jest normalizowany do małych liter (%s)", (slug) => {
    // Parser oddaje slug małymi literami, ale bylina i katalog dostają go też
    // z innych źródeł - odczyt musi normalizować, nie ufać wołającemu.
    const { result } = renderHook(() => useMentionEntity(slug), { wrapper: withProvider() });

    expect(result.current).toEqual(ANNA);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
  ])("slug %s oddaje `null` bez zaglądania do mapy", (_opis, slug) => {
    const { result } = renderHook(() => useMentionEntity(slug), { wrapper: withProvider() });

    expect(result.current).toBeNull();
  });

  it("rozwiązuje też organizacje, nie tylko osoby", () => {
    const { result } = renderHook(() => useMentionEntity("acme"), { wrapper: withProvider() });

    expect(result.current).toEqual(ACME);
  });
});

describe("MentionDirectoryProvider", () => {
  it("przekazuje komplet slugów i język do JEDNEGO zapytania powierzchni", () => {
    renderHook(() => useMentionEntity("anna-nowak"), {
      wrapper: withProvider(["anna-nowak", "acme"], "en"),
    });

    expect(state.calls[0]).toEqual({ slugs: ["anna-nowak", "acme"], lang: "en" });
  });
});
