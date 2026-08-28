import { describe, expect, it } from "vitest";

import { parseMeetingDirectory } from "@/lib/events/meetingDirectory";

describe("katalog: dane wizytówki", () => {
  it("czyta konto, zdjęcie, logo firmy i profil zawodowy", () => {
    const parsed = parseMeetingDirectory({
      rows: [
        {
          registration_id: "r1",
          first_name: "Anna",
          last_name: "Kowalska",
          user_id: "u1",
          photo_url: "https://cdn.example/a.jpg",
          company: "ACME",
          company_logo_url: "https://cdn.example/acme.png",
          industry: "Energetyka",
          specialization: "Regulacje",
        },
      ],
    });
    expect(parsed.rows[0]).toMatchObject({
      userId: "u1",
      photoUrl: "https://cdn.example/a.jpg",
      companyLogoUrl: "https://cdn.example/acme.png",
      industry: "Energetyka",
      specialization: "Regulacje",
    });
  });
});
