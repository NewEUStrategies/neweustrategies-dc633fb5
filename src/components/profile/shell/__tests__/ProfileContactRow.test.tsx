import { render } from "@testing-library/react";
import { Linkedin, Mail, MapPin, Phone } from "lucide-react";
import { describe, expect, it } from "vitest";

import { XIcon } from "@/components/atoms/XIcon";
import { ProfileContactRow } from "../ProfileShell";

describe("ProfileContactRow", () => {
  it.each([
    { key: "x", icon: <XIcon className="h-4 w-4" />, label: "X" },
    { key: "linkedin", icon: <Linkedin className="h-4 w-4" />, label: "LinkedIn" },
    { key: "mail", icon: <Mail className="h-4 w-4" />, label: "E-mail" },
    { key: "phone", icon: <Phone className="h-4 w-4" />, label: "Telefon" },
    { key: "location", icon: <MapPin className="h-4 w-4" />, label: "Lokalizacja" },
  ])(
    "wymusza białą ikonę SVG przy group-hover dla $label (najedzenie obok kafelka)",
    ({ key, icon, label }) => {
      const { container } = render(
        <ul>
          <ProfileContactRow icon={icon} ariaLabel={label} brandKey={key as never}>
            <span>content</span>
          </ProfileContactRow>
        </ul>,
      );
      const tile = container.querySelector("li > span");
      expect(tile).toBeTruthy();
      const cls = tile?.className ?? "";
      expect(cls).toContain("group-hover:[&_svg]:[color:white]!");
      expect(cls).toContain("group-focus-within:[&_svg]:[color:white]!");
    },
  );
});
