// Molekuła pól kreacji: KTÓRE pole należy do którego rodzaju slotu.
//
// CO TEN PLIK DOWODZI.
//   1. RODZAJ SLOTU DECYDUJE O ZESTAWIE PÓL, i to rozłącznie: przy `html` nie
//      ma pola skryptu, przy `image` nie ma ani jednego pola wykonywalnego.
//      Pole widoczne „przy okazji" innego rodzaju to zaproszenie do wklejenia
//      skryptu w slot, który go nie wykona (albo odwrotnie).
//   2. OSTRZEŻENIE O IZOLOWANEJ RAMCE STOI PRZY OBU POLACH WYKONYWALNYCH
//      (html i script) i NIE stoi przy grafice. To jedyne miejsce, w którym
//      panel mówi redaktorowi, że wklejony kod nie dostanie sesji czytelnika -
//      brak tego zdania przy jednym z dwóch pól jest defektem informacyjnym,
//      którego nie widać w recenzji, bo oba akapity są tam prawie identyczne.
//   3. ZMIANA ODDAJE ŁATKĘ NA POLE KOLUMNY (`html`, `script`, `image_url`,
//      `image_link`, `image_alt`) - nazwa pola jest kontraktem z bazą.
//   4. POLE NIE MA STANU WŁASNEGO: pokazuje dokładnie to, co dostało propsem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tego, że przełączenie rodzaju NIE GUBI
// wpisanej treści - to decyzja draftu, dowodzona w `AdSlotForm.test.tsx`.
// (2) Ładunku insertu - test organizmu `AdSlotsPanel`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));

import {
  AdSlotKindFields,
  type AdSlotKindValues,
} from "@/components/admin/ads/molecules/AdSlotKindFields";
import type { AdSlotKind } from "@/lib/ads/types";

const EMPTY: AdSlotKindValues = {
  html: "",
  script: "",
  imageUrl: "",
  imageLink: "",
  imageAlt: "",
};

function renderFields(kind: AdSlotKind, values: Partial<AdSlotKindValues> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <AdSlotKindFields kind={kind} values={{ ...EMPTY, ...values }} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

const SANDBOX_HTML =
  "Kreacja wykonuje się w izolowanej ramce (sandbox) - bez dostępu do sesji czytelnika i DOM strony.";
const SANDBOX_SCRIPT =
  "Skrypt wykonuje się w izolowanej ramce (sandbox) - bez dostępu do sesji czytelnika i DOM strony.";

describe("pola kreacji: rodzaj html", () => {
  it("pyta o kod HTML i NIE pokazuje pól skryptu ani grafiki", () => {
    renderFields("html");
    expect(screen.getByLabelText("adsAdmin.slots.fieldHtml")).toBeTruthy();
    expect(screen.queryByLabelText("Skrypt (np. AdSense)")).toBeNull();
    expect(screen.queryByLabelText("URL grafiki")).toBeNull();
  });

  it("ostrzega o izolowanej ramce - kreacja nie dostaje sesji czytelnika", () => {
    renderFields("html");
    expect(screen.getByText(SANDBOX_HTML)).toBeTruthy();
  });

  it("wpisanie kodu oddaje łatkę na kolumnę `html`", () => {
    const { onChange } = renderFields("html");
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldHtml"), {
      target: { value: "<b>x</b>" },
    });
    expect(onChange).toHaveBeenCalledWith({ html: "<b>x</b>" });
  });

  it("pokazuje wartość z propsa, bez własnego stanu", () => {
    renderFields("html", { html: "<i>zapisane</i>" });
    expect((screen.getByLabelText("adsAdmin.slots.fieldHtml") as HTMLTextAreaElement).value).toBe(
      "<i>zapisane</i>",
    );
  });
});

describe("pola kreacji: rodzaj script", () => {
  it("pyta o skrypt i NIE pokazuje pola HTML", () => {
    renderFields("script");
    expect(screen.getByLabelText("Skrypt (np. AdSense)")).toBeTruthy();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldHtml")).toBeNull();
  });

  it("ostrzeżenie o izolowanej ramce stoi TAKŻE przy skrypcie", () => {
    renderFields("script");
    expect(screen.getByText(SANDBOX_SCRIPT)).toBeTruthy();
  });

  it("wpisanie skryptu oddaje łatkę na kolumnę `script`", () => {
    const { onChange } = renderFields("script");
    fireEvent.change(screen.getByLabelText("Skrypt (np. AdSense)"), {
      target: { value: "console.log(1)" },
    });
    expect(onChange).toHaveBeenCalledWith({ script: "console.log(1)" });
  });
});

describe("pola kreacji: rodzaj image", () => {
  it("pyta o URL, link kliknięcia i tekst alternatywny", () => {
    renderFields("image");
    expect(screen.getByLabelText("URL grafiki")).toBeTruthy();
    expect(screen.getByLabelText("adsAdmin.slots.fieldClickUrl")).toBeTruthy();
    expect(screen.getByLabelText("adsAdmin.slots.fieldAlt")).toBeTruthy();
  });

  it("NIE pokazuje ani jednego pola wykonywalnego ani ostrzeżenia o sandboxie", () => {
    renderFields("image");
    expect(screen.queryByLabelText("adsAdmin.slots.fieldHtml")).toBeNull();
    expect(screen.queryByLabelText("Skrypt (np. AdSense)")).toBeNull();
    expect(screen.queryByText(SANDBOX_HTML)).toBeNull();
    expect(screen.queryByText(SANDBOX_SCRIPT)).toBeNull();
  });

  it("trzy pola grafiki mapują się na trzy RÓŻNE kolumny", () => {
    const { onChange } = renderFields("image");
    fireEvent.change(screen.getByLabelText("URL grafiki"), {
      target: { value: "https://cdn.example.com/a.png" },
    });
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldClickUrl"), {
      target: { value: "https://example.com/oferta" },
    });
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldAlt"), {
      target: { value: "Reklama partnera" },
    });
    expect(onChange.mock.calls.map(([patch]) => patch)).toEqual([
      { image_url: "https://cdn.example.com/a.png" },
      { image_link: "https://example.com/oferta" },
      { image_alt: "Reklama partnera" },
    ]);
  });
});
