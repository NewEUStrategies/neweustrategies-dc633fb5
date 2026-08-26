// Bramka CI: z panelu MUSI istnieć droga do usunięcia wydarzenia.
//
// DLACZEGO TO JEST BRAMKA, A NIE ZWYKŁY TEST. Usuwanie wydarzenia żyło
// wyłącznie w dialogu na trasie `/admin/community/events`. Kiedy ta trasa
// dostała przekierowanie do listy modułu, `deleteEvent` zostało w
// `src/lib/admin/community.ts` z własnym testem jednostkowym - zielonym, bo
// funkcja działa - i BEZ ANI JEDNEGO wywołania z interfejsu. Operacja
// administracyjna zniknęła z panelu, a cała suita przechodziła: testy pilnowały
// funkcji, nie jej dostępności.
//
// Ten skan patrzy od strony POWIERZCHNI: czy `deleteEvent` jest w ogóle
// zaimportowane przez coś, co się montuje. Test wywołania w `community.test.ts`
// tego nie zastąpi, bo import w pliku testowym też jest „wywołaniem".
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Katalogi montowanej powierzchni panelu - bez `__tests__`. */
const SURFACE_DIRS = ["src/components/admin/events", "src/routes"] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const SURFACE = SURFACE_DIRS.flatMap(sourceFiles).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

const LIST_MANAGER = readFileSync(
  "src/components/admin/events/organisms/EventsListManager.tsx",
  "utf8",
);

describe("usuwanie wydarzenia jest osiągalne z panelu", () => {
  it("`deleteEvent` jest importowane przez CO NAJMNIEJ JEDEN montowany plik", () => {
    // Sam import nie dowodzi, że przycisk jest widoczny - ale jego BRAK dowodzi,
    // że nie ma go nigdzie. To jest ten kierunek, który zawiódł poprzednio.
    const importers = SURFACE.filter(
      (file) => /\bdeleteEvent\b/.test(file.text) && /@\/lib\/admin\/community/.test(file.text),
    ).map((file) => file.path);
    expect(importers).not.toEqual([]);
  });

  it("lista modułu ma potwierdzenie i akcję w kolorze zagrożenia", () => {
    // Usunięcie wydarzenia kasuje zapisy, agendę i historię - bez potwierdzenia
    // jedno kliknięcie obok ołówka kosztuje dane, których nie da się odtworzyć.
    expect(LIST_MANAGER).toContain("deleteEvent");
    expect(LIST_MANAGER).toContain("adminCommunityEvents.deleteTitle");
    expect(LIST_MANAGER).toContain('variant="destructive"');
  });

  it("nie usuwa się z WNĘTRZA studia edytowanego wydarzenia", () => {
    // Skasowanie wydarzenia z jego własnego ekranu zostawia otwarte studio
    // czegoś, co już nie istnieje - każda kolejna zakładka celuje w martwe id.
    // Akcja należy do listy, bo tam jest miejsce, do którego można wrócić.
    const studio = SURFACE.filter((file) => file.path.includes("/events/studio/"));
    expect(studio.filter((file) => /\bdeleteEvent\b/.test(file.text)).map((f) => f.path)).toEqual(
      [],
    );
  });
});
