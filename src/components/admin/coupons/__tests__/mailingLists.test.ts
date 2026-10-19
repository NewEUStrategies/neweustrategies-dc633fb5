// Listy mailingowe jako segment kampanii kuponowej (P04, R-25).
//
// PO CO. Serwer wysyłki dopasowuje segment do `id` listy z
// `newsletter_settings.popup_mailing_lists` i odrzuca nieznany. Opcje
// formularza i etykiety w tabeli MUSZĄ więc wychodzić z tych samych
// identyfikatorów - etykieta bez listy to sygnał, że wysyłka segment odrzuci.
import { describe, expect, it } from "vitest";
import type { NewsletterMailingList } from "@/hooks/useNewsletterSettings";
import { WHOLE_LIST_SEGMENT, mailingListLabel, mailingListOptions } from "../mailingLists";

const LISTY: NewsletterMailingList[] = [
  { id: "vip", label_pl: "Lista VIP", label_en: "VIP list" },
  { id: "partnerzy", label_pl: "Partnerzy", label_en: "" },
  { id: "  ", label_pl: "Pusta", label_en: "Empty" },
  { id: "vip", label_pl: "Duplikat", label_en: "Duplicate" },
];

describe("mailingListOptions", () => {
  it("opcja = id listy + etykieta w języku interfejsu", () => {
    expect(mailingListOptions(LISTY, "pl")).toEqual([
      { value: "vip", label: "Lista VIP" },
      { value: "partnerzy", label: "Partnerzy" },
    ]);
  });

  it("pusta etykieta w języku interfejsu bierze drugą wersję językową", () => {
    expect(mailingListOptions(LISTY, "en")).toEqual([
      { value: "vip", label: "VIP list" },
      { value: "partnerzy", label: "Partnerzy" },
    ]);
  });

  it("puste i powtórzone identyfikatory odpadają - wysyłka nie miałaby czego dopasować", () => {
    expect(mailingListOptions(LISTY, "pl").map((o) => o.value)).toEqual(["vip", "partnerzy"]);
  });

  it("brak ustawień = brak list (bez wywrotki)", () => {
    expect(mailingListOptions(undefined, "pl")).toEqual([]);
  });

  it("opcja „cała lista” nie koliduje z identyfikatorem żadnej listy", () => {
    expect(mailingListOptions(LISTY, "pl").map((o) => o.value)).not.toContain(WHOLE_LIST_SEGMENT);
  });
});

describe("mailingListLabel", () => {
  it("znany segment = nazwa listy, nieznany = null", () => {
    expect(mailingListLabel("vip", LISTY, "pl")).toBe("Lista VIP");
    expect(mailingListLabel("stary-tag", LISTY, "pl")).toBeNull();
  });
});
