// DOWÓD NA ZAINSTALOWANYM DRZEWIE: edytor treści ma JEDNĄ kopię `prosemirror-view`.
//
// CO TEN PLIK DOWODZI.
//   1. KURSOR MIĘDZY BLOKAMI NIE WYWRACA EDYTORA, gdy działa drugie źródło
//      dekoracji. `DecorationGroup.from` w `prosemirror-view` łączy zestawy
//      dekoracji po `instanceof DecorationSet`. Do 2026-09-23 `bun.lock` trzymał
//      pod `prosemirror-gapcursor` (i czterema innymi pakietami) zagnieżdżoną
//      kopię 1.41.8 obok 1.42.4, z której korzysta widok. Zestaw kursora z tej
//      drugiej kopii nie przechodził `instanceof`, do grupy trafiało
//      `undefined`, a pierwsze przerysowanie kończyło się
//      `TypeError: Cannot read properties of undefined (reading 'localsInner')`.
//      Zmierzone na drzewie sprzed poprawki - ten sam przypadek niżej był
//      czerwony z dokładnie tym komunikatem.
//   2. MODUŁY SĄ TE, KTÓRYCH UŻYWA APLIKACJA: `@tiptap/pm/*`, czyli to, co
//      importuje StarterKit. Test na samych `prosemirror-*` mógłby przejść na
//      drzewie, na którym aplikacja się wywraca.
//
// DLACZEGO TEN TEST OBOK BRAMKI. `check:module-singletons` czyta `bun.lock`;
// ten plik sprawdza skutek w działaniu. Bramka mówi „jest druga kopia", test
// mówi „i to jest błąd, a nie kosmetyka".
import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { GapCursor, gapCursor } from "@tiptap/pm/gapcursor";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    rule: { group: "block", toDOM: () => ["hr"] },
    text: {},
  },
});

/** Drugie źródło dekoracji - jak podpowiedź w pustym akapicie albo wyszukiwanie. */
const highlight = new Plugin({
  props: {
    decorations: (state) =>
      DecorationSet.create(state.doc, [Decoration.inline(2, 4, { class: "hl" })]),
  },
});

function editor(): EditorView {
  const doc = schema.node("doc", null, [
    schema.node("rule"),
    schema.node("paragraph", null, [schema.text("abc")]),
  ]);
  const place = document.createElement("div");
  document.body.appendChild(place);
  return new EditorView(place, {
    state: EditorState.create({ doc, plugins: [gapCursor(), highlight] }),
  });
}

describe("jedna kopia prosemirror-view w edytorze", () => {
  it("kursor przed blokiem bez tekstu rysuje się obok innej dekoracji bez błędu", () => {
    const view = editor();

    expect(() =>
      view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(0)))),
    ).not.toThrow();
    expect(view.state.selection).toBeInstanceOf(GapCursor);
    expect(view.dom.querySelector(".ProseMirror-gapcursor")).not.toBeNull();
    expect(view.dom.querySelector(".hl")?.textContent).toBe("ab");
    view.destroy();
  });

  it("zestaw dekoracji kursora jest tą samą klasą, którą widok rozpoznaje", () => {
    const view = editor();
    view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(0))));

    const sets: unknown[] = [];
    view.someProp("decorations", (f) => {
      sets.push(f.call(view, view.state));
    });

    expect(sets).toHaveLength(2);
    for (const set of sets) expect(set).toBeInstanceOf(DecorationSet);
    view.destroy();
  });
});
