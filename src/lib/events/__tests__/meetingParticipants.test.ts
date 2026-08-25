import { describe, expect, it } from "vitest";
import { participantLabel, toParticipantOption } from "@/lib/events/meetingParticipants";

describe("participantLabel", () => {
  it("sklada imie, firme i stanowisko myslnikiem", () => {
    expect(
      participantLabel({
        first_name: "Anna",
        last_name: "Kowalska",
        company_name: "NES",
        job_title: "Director",
      }),
    ).toBe("Anna Kowalska - NES - Director");
  });

  it("pomija puste czesci zamiast zostawiac wiszace separatory", () => {
    expect(participantLabel({ first_name: "Jan", last_name: "Nowak" })).toBe("Jan Nowak");
    expect(participantLabel({ first_name: " ", last_name: null, company_text: "Acme" })).toBe(
      "Acme",
    );
  });

  it("uzywa company_text, gdy zgloszenie nie ma powiazanej firmy", () => {
    expect(
      participantLabel({ first_name: "Ola", last_name: "Zet", company_text: "Firma z wpisu" }),
    ).toBe("Ola Zet - Firma z wpisu");
  });
});

describe("toParticipantOption", () => {
  it("mapuje zgloszenie na wybor giełdy po registration_id", () => {
    const option = toParticipantOption({
      id: "reg-1",
      first_name: "Anna",
      last_name: "Kowalska",
      company_name: null,
      company_text: "NES",
      job_title: null,
      group_id: "grp-1",
    });
    expect(option).toEqual({
      registrationId: "reg-1",
      firstName: "Anna",
      lastName: "Kowalska",
      company: "NES",
      jobTitle: "",
      groupId: "grp-1",
      label: "Anna Kowalska - NES",
    });
  });

  it("traktuje pusty group_id jako brak grupy", () => {
    expect(toParticipantOption({ id: "reg-2", group_id: "" }).groupId).toBeNull();
  });
});
