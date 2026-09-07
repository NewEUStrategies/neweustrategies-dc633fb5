import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { XIcon } from "@/components/atoms/XIcon";
import { ProfileContactRow } from "../ProfileShell";

describe("ProfileContactRow", () => {
  it("wymusza białą ikonę SVG przy group-hover (najedzenie obok kafelka)", () => {
    const { container } = render(
      <ul>
        <ProfileContactRow icon={<XIcon className="h-4 w-4" />} ariaLabel="X" brandKey="x">
          <a href="https://x.com/nes">x.com/nes</a>
        </ProfileContactRow>
      </ul>,
    );
    const tile = container.querySelector("li > span");
    expect(tile).toBeTruthy();
    const cls = tile?.className ?? "";
    expect(cls).toContain("group-hover:[&_svg]:[color:white]!");
    expect(cls).toContain("group-focus-within:[&_svg]:[color:white]!");
  });
});
