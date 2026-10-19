// GLOWNY EDYTOR WPISU (`PostBlockEditor`) - REJESTR ENCJI INLINE W DWOCH JEZYKACH.
//
// Rejestr firm i osob (`doc.meta.inlineEntities`) jest WSPOLNY dla wersji PL
// i EN: redaktor dodaje firme w jednym jezyku, a wersja druga musi ja znac,
// bo inaczej odwolanie w tlumaczeniu wskazuje rekord, ktorego nie ma.
// Lustrzenie robi `PostBlockEditor` na granicy `onChange` rodzica.
//
// CO MA TU DOWOD
//   * edycja w aktywnym jezyku przenosi rejestr do drugiej wersji, a TRESC
//     drugiej wersji (jej bloki) zostaje nietknieta,
//   * kolejna edycja bez zmiany rejestru oddaje druga wersje TYM SAMYM
//     obiektem - pisanie nie tworzy nowych referencji drugiego jezyka (dla
//     autosave'u nowa referencja to nowa wartosc do zapisu),
//   * zmiana rejestru z menedzera encji jest krokiem HISTORII dokumentu:
//     cofniecie przywraca usuniety rekord - i to w obu jezykach naraz.
//
// GRANICE: `sonner` (toasty) i przewodnik onboardingowy (`CoachmarkTour` mierzy
// geometrie, ktorej happy-dom nie ma). Kanwa, sidebar, menedzer encji, hook
// historii i lustro rejestru sa prawdziwe; slownik prawdziwy (`realT`).
// Rodzic trzyma `value` w stanie i oddaje edytorowi to, co od niego dostal -
// jak formularz wpisu.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { readInlineEntities } from "@/lib/blocks/inlineEntities/registry";
import {
  company,
  docWith,
  paragraph,
  person,
  token,
} from "@/lib/blocks/inlineEntities/__tests__/fixtures";
import { realT } from "@/test/i18nReal";
// Slownik panelu `admin.*` - w aplikacji rejestruje go `AdminSession`.
import "@/lib/i18n-admin-core";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({
  CoachmarkTour: () => null,
}));

const { PostBlockEditor } = await import("../PostBlockEditor");

const t = realT("pl");

function zamontuj(startowa: LocalizedBlocks): LocalizedBlocks[] {
  const zmiany: LocalizedBlocks[] = [];
  function Rodzic() {
    const [v, setV] = useState(startowa);
    return (
      <PostBlockEditor
        value={v}
        onChange={(next) => {
          zmiany.push(next);
          setV(next);
        }}
        documentPane={null}
      />
    );
  }
  render(<Rodzic />);
  return zmiany;
}

/** Realna zmiana dokumentu przez UI kanwy: klik w blok + Ctrl+Shift+D (duplikat). */
function duplikuj(blockId: string): void {
  const wiersz = document.querySelector(`[data-block-canvas] [data-block-id="${blockId}"]`);
  if (!wiersz) throw new Error(`brak wiersza bloku ${blockId} w kanwie`);
  fireEvent.click(wiersz);
  fireEvent.keyDown(document.body, { key: "d", ctrlKey: true, shiftKey: true });
}

function ostatnia(zmiany: LocalizedBlocks[]): LocalizedBlocks {
  const z = zmiany.at(-1);
  if (!z) throw new Error("edytor nie oddal zadnej zmiany");
  return z;
}

function idyRejestru(d: BlocksDoc): string[] {
  return Object.keys(readInlineEntities(d)).sort();
}

const EN_BEZ_REJESTRU: BlocksDoc = {
  version: 1,
  blocks: [paragraph("e1", "<p>English text</p>")],
};

describe("PostBlockEditor - lustro rejestru encji inline", () => {
  it("edycja PL przenosi rejestr do EN, a bloki EN zostaja nietkniete", () => {
    const acme = company({ name: "Acme PL" });
    const zmiany = zamontuj({
      pl: docWith([paragraph("p1", `<p>Firma ${token(acme)}</p>`)], [acme]),
      en: EN_BEZ_REJESTRU,
    });

    duplikuj("p1");

    const { pl, en } = ostatnia(zmiany);
    expect(pl.blocks).toHaveLength(2);
    expect(readInlineEntities(en)).toEqual({ [acme.id]: acme });
    expect(en.blocks).toEqual(EN_BEZ_REJESTRU.blocks);
  });

  it("kolejna edycja bez zmiany rejestru oddaje EN TYM SAMYM obiektem", () => {
    const acme = company();
    const zmiany = zamontuj({
      pl: docWith([paragraph("p1", `<p>${token(acme)}</p>`)], [acme]),
      en: EN_BEZ_REJESTRU,
    });

    duplikuj("p1");
    const poPierwszej = ostatnia(zmiany).en;
    duplikuj("p1");

    expect(ostatnia(zmiany).pl.blocks).toHaveLength(3);
    expect(ostatnia(zmiany).en).toBe(poPierwszej);
  });

  it("bez rejestru po obu stronach EN przechodzi bez kopii (ten sam obiekt co od rodzica)", () => {
    const zmiany = zamontuj({
      pl: { version: 1, blocks: [paragraph("p1", "<p>tekst</p>")] },
      en: EN_BEZ_REJESTRU,
    });

    duplikuj("p1");

    expect(ostatnia(zmiany).en).toBe(EN_BEZ_REJESTRU);
  });
});

describe("PostBlockEditor - menedzer encji pisze przez historie dokumentu", () => {
  it("usuniecie nieuzywanej osoby znika w OBU jezykach, a cofniecie przywraca ja w obu", () => {
    const maya = person();
    const zmiany = zamontuj({
      pl: docWith([paragraph("p1", "<p>tekst</p>")], [maya]),
      en: docWith([paragraph("e1", "<p>text</p>")], [maya]),
    });

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("blocks.inlineEntity.manageShort")) }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(`^${t("blocks.inlineEntity.manager.remove")}: .*Maya`),
      }),
    );

    // EN nie odwoluje sie do rekordu, wiec lustro zdejmuje go takze tam.
    expect(idyRejestru(ostatnia(zmiany).pl)).toEqual([]);
    expect(idyRejestru(ostatnia(zmiany).en)).toEqual([]);

    // Modalny dialog chowa reszte ekranu przed drzewem dostepnosci - zamykamy go.
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: t("blocks.inlineEntity.manager.close") })[0],
    );
    const pasek = document.querySelector('[data-tour="blocks-history"]') as HTMLElement;
    fireEvent.click(within(pasek).getByRole("button", { name: t("blocks.actions.undo") }));

    expect(idyRejestru(ostatnia(zmiany).pl)).toEqual([maya.id]);
    expect(idyRejestru(ostatnia(zmiany).en)).toEqual([maya.id]);
    expect(ostatnia(zmiany).en.blocks.map((b) => b.id)).toEqual(["e1"]);
  });
});
