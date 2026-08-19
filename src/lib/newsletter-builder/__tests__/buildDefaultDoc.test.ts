// Fabryka domyślnego dokumentu formularza (inline i popup).
//
// PO CO TO JEST WAŻNE. `buildDefaultDoc` uruchamia się dokładnie raz na
// instalację: kiedy operator pierwszy raz wchodzi do buildera, a w bazie nie ma
// jeszcze dokumentu. Dostaje wtedy formularz zbudowany z USTAWIEŃ tenanta -
// nagłówka, opisu, treści zgód, etykiety przycisku. Jeśli któryś z tych
// elementów wypadnie po cichu, operator zaczyna od formularza, w którym
// BRAKUJE POLA ZGODY albo klauzuli RODO, i najczęściej tego nie zauważy,
// bo nie wie, że coś miało tam być.
//
// Dlatego każde pole zaczepu (`seed`) ma tu przypadek „jest" i „nie ma",
// a kolejność widgetów jest przybita - to ona decyduje, czy checkbox zgody
// stoi przed przyciskiem wysyłki, czy za nim.
import { describe, it, expect } from "vitest";
import { buildDefaultDoc, emptyDoc } from "@/lib/newsletter-builder/defaults";
import { NlDocSchema } from "@/lib/newsletter-builder/schema";
import type { NlWidget } from "@/lib/newsletter-builder/types";

/** Typy widgetów pierwszej sekcji, w kolejności ułożenia. */
function types(doc: { sections: { widgets: NlWidget[] }[] }): string[] {
  return (doc.sections[0]?.widgets ?? []).map((w) => w.type);
}

const TEXT = { pl: "Polski", en: "English" };

describe("dokument pusty", () => {
  it("ma jedną, pustą sekcję i przechodzi walidację", () => {
    const doc = emptyDoc("inline");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.widgets).toEqual([]);
    expect(NlDocSchema.safeParse(doc).success).toBe(true);
  });

  it("pamięta wariant", () => {
    expect(emptyDoc("popup").variant).toBe("popup");
    expect(emptyDoc("inline").variant).toBe("inline");
  });
});

describe("szkielet obowiązkowy", () => {
  it("BEZ żadnych ustawień ma nagłówek, pole e-mail i przycisk", () => {
    const doc = buildDefaultDoc("inline");

    expect(types(doc)).toEqual(["heading", "field.email", "submit"]);
    expect(NlDocSchema.safeParse(doc).success).toBe(true);
  });

  it("pole e-mail jest ZAWSZE - bez niego formularz nie zbiera niczego", () => {
    for (const variant of ["inline", "popup"] as const) {
      expect(types(buildDefaultDoc(variant))).toContain("field.email");
    }
  });

  it("każda sekcja ma własny identyfikator i styl", () => {
    const doc = buildDefaultDoc("inline");
    const section = doc.sections[0];

    expect(section?.id).toBeTruthy();
    expect(section?.style).toMatchObject({ align: "left" });
  });

  it("dwa wywołania dają RÓŻNE identyfikatory - dokumenty się nie zlepiają", () => {
    const a = buildDefaultDoc("inline");
    const b = buildDefaultDoc("inline");

    expect(a.sections[0]?.id).not.toBe(b.sections[0]?.id);
  });
});

describe("zaczepy treści z ustawień tenanta", () => {
  it("nagłówek z ustawień nadpisuje domyślny", () => {
    const doc = buildDefaultDoc("inline", { heading: TEXT });
    const heading = doc.sections[0]?.widgets[0] as { text?: unknown };

    expect(heading.text).toEqual(TEXT);
    expect(types(doc)[0]).toBe("heading");
  });

  it("opis dokłada akapit ZA nagłówkiem", () => {
    const doc = buildDefaultDoc("inline", { description: TEXT });

    expect(types(doc)).toEqual(["heading", "paragraph", "field.email", "submit"]);
  });

  it("opis PUSTY w obu językach nie dokłada pustego akapitu", () => {
    const doc = buildDefaultDoc("inline", { description: { pl: "", en: "" } });

    expect(types(doc)).not.toContain("paragraph");
  });

  it("opis w JEDNYM języku wystarcza, żeby akapit powstał", () => {
    const doc = buildDefaultDoc("inline", { description: { pl: "Tylko polski", en: "" } });

    expect(types(doc)).toContain("paragraph");
  });

  it("etykieta przycisku z ustawień trafia do przycisku", () => {
    const doc = buildDefaultDoc("inline", { submitLabel: TEXT });
    const submit = doc.sections[0]?.widgets.find((w) => w.type === "submit") as { label?: unknown };

    expect(submit.label).toEqual(TEXT);
  });

  it("komunikat sukcesu dokłada własny widget", () => {
    const doc = buildDefaultDoc("inline", { successMsg: TEXT });

    expect(types(doc)).toContain("success-message");
  });
});

describe("zgody i klauzula RODO", () => {
  it("wymagana zgoda z treścią dokłada CHECKBOX", () => {
    const doc = buildDefaultDoc("popup", {
      requireTerms: true,
      termsHtml: { pl: "<p>Zgoda</p>", en: "<p>Consent</p>" },
    });

    expect(types(doc)).toContain("field.checkbox");
  });

  it("wymagana zgoda BEZ treści nie tworzy pustego checkboxa", () => {
    const doc = buildDefaultDoc("popup", {
      requireTerms: true,
      termsHtml: { pl: null, en: null },
    });

    expect(types(doc)).not.toContain("field.checkbox");
  });

  it("treść zgody BEZ flagi wymagania nie dokłada checkboxa", () => {
    const doc = buildDefaultDoc("popup", { termsHtml: { pl: "<p>Zgoda</p>", en: null } });

    expect(types(doc)).not.toContain("field.checkbox");
  });

  it("brakujący język zgody schodzi na pusty napis, nie na `null`", () => {
    const doc = buildDefaultDoc("popup", {
      requireTerms: true,
      termsHtml: { pl: "<p>Zgoda</p>", en: null },
    });
    const chk = doc.sections[0]?.widgets.find((w) => w.type === "field.checkbox") as {
      html?: { pl?: string; en?: string };
    };

    expect(chk.html?.en).toBe("");
    expect(chk.html?.pl).toBe("<p>Zgoda</p>");
  });

  it("klauzula RODO dokłada MAŁY akapit", () => {
    const doc = buildDefaultDoc("inline", {
      policyHtml: { pl: "<p>Informacja</p>", en: "<p>Notice</p>" },
    });
    const policy = doc.sections[0]?.widgets.filter((w) => w.type === "paragraph") as {
      size?: string;
    }[];

    expect(policy).toHaveLength(1);
    expect(policy[0]?.size).toBe("sm");
  });

  it("klauzula pusta w obu językach nie dokłada akapitu", () => {
    const doc = buildDefaultDoc("inline", { policyHtml: { pl: null, en: null } });

    expect(types(doc)).not.toContain("paragraph");
  });

  it("checkbox zgody stoi ZA przyciskiem, klauzula RODO za nim", () => {
    // Kolejność jest zachowaniem: to ona decyduje o układzie formularza,
    // który operator zobaczy jako punkt wyjścia.
    const doc = buildDefaultDoc("popup", {
      requireTerms: true,
      termsHtml: { pl: "<p>Zgoda</p>", en: "<p>Consent</p>" },
      policyHtml: { pl: "<p>Informacja</p>", en: "<p>Notice</p>" },
      successMsg: TEXT,
    });

    expect(types(doc)).toEqual([
      "heading",
      "field.email",
      "submit",
      "field.checkbox",
      "paragraph",
      "success-message",
    ]);
  });
});

describe("popup - okładka i styl", () => {
  it("okładka dokłada OBRAZ na samym początku", () => {
    const doc = buildDefaultDoc("popup", { coverUrl: "https://example.test/cover.png" });

    expect(types(doc)[0]).toBe("image");
  });

  it("obraz dostaje adres i proporcje okładki", () => {
    const doc = buildDefaultDoc("popup", { coverUrl: "https://example.test/cover.png" });
    const img = doc.sections[0]?.widgets[0] as { url?: string; aspect?: string };

    expect(img.url).toBe("https://example.test/cover.png");
    expect(img.aspect).toBe("16/7");
  });

  it("okładka w wariancie INLINE jest ignorowana - mail nie ma okładki popupu", () => {
    const doc = buildDefaultDoc("inline", { coverUrl: "https://example.test/cover.png" });

    expect(types(doc)).not.toContain("image");
  });

  it("popup dostaje blok stylu z domyślnym układem i promieniem", () => {
    const doc = buildDefaultDoc("popup");

    expect(doc.popup).toMatchObject({ layout: "stacked", radius: 16 });
  });

  it("wariant inline NIE dostaje bloku stylu popupu", () => {
    const doc = buildDefaultDoc("inline");

    expect(doc.popup).toBeUndefined();
    expect(NlDocSchema.safeParse(doc).success).toBe(true);
  });

  it("ustawiony układ i promień nadpisują domyślne", () => {
    const doc = buildDefaultDoc("popup", { popupStyle: { layout: "split", radius: 4 } });

    expect(doc.popup).toMatchObject({ layout: "split", radius: 4 });
  });

  it("kolory są przenoszone tylko wtedy, gdy naprawdę są", () => {
    const withColors = buildDefaultDoc("popup", {
      popupStyle: {
        bg: "#fff",
        fg: "#000",
        muted: "#888",
        accent: "#f00",
        accentFg: "#fff",
        overlay: "rgba(0,0,0,.5)",
        sideImage: "https://example.test/side.png",
      },
    });
    const withoutColors = buildDefaultDoc("popup", {
      popupStyle: { bg: null, fg: null, sideImage: null },
    });

    expect(withColors.popup).toMatchObject({
      bg: "#fff",
      accent: "#f00",
      sideImage: expect.any(String),
    });
    // Pusty kolor NIE trafia do dokumentu jako `null` - inaczej nadpisałby
    // wartość z tokenów wyglądu.
    expect(withoutColors.popup).not.toHaveProperty("bg");
    expect(withoutColors.popup).not.toHaveProperty("sideImage");
  });

  it("dokument popupu z pełnym zaczepem nadal przechodzi walidację", () => {
    const doc = buildDefaultDoc("popup", {
      heading: TEXT,
      description: TEXT,
      submitLabel: TEXT,
      successMsg: TEXT,
      coverUrl: "https://example.test/cover.png",
      requireTerms: true,
      termsHtml: { pl: "<p>Zgoda</p>", en: "<p>Consent</p>" },
      policyHtml: { pl: "<p>Informacja</p>", en: "<p>Notice</p>" },
      popupStyle: { layout: "showcase", radius: 24, bg: "#fff" },
    });

    const parsed = NlDocSchema.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // obraz + nagłówek + opis + e-mail + przycisk + zgoda + klauzula + sukces
    expect(doc.sections[0]?.widgets.length).toBe(8);
  });
});
