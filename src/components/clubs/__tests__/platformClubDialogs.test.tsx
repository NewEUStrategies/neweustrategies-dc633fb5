// Existing repository coverage gates also apply to dialogs loaded lazily by
// the platform. Exercise the real forms and mutation callbacks; database/RLS
// contracts remain in the existing club API and PostgreSQL tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  pending: false,
  propose:
    vi.fn<
      (data: unknown, callbacks: { onSuccess: () => void; onError: (error: Error) => void }) => void
    >(),
  save: vi.fn<
    (
      data: unknown,
      callbacks: { onSuccess: (changed: boolean) => void; onError: (error: Error) => void },
    ) => void
  >(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/clubs/useClubs", () => ({
  useProposeClub: () => ({ mutate: h.propose, isPending: h.pending }),
  useUpdateClubSettings: () => ({ mutate: h.save, isPending: h.pending }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      disabled: boolean;
      children: ReactNode;
    }) => {
      const parts = React.Children.toArray(children);
      const trigger = parts.find(
        (part) => React.isValidElement<{ id?: string }>(part) && part.props.id,
      );
      const id = React.isValidElement<{ id?: string }>(trigger) ? trigger.props.id : undefined;
      return (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {parts.filter((part) => part !== trigger)}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});
import { ClubProposeDialog } from "../molecules/ClubProposeDialog";
import { ClubSettingsDialog, type ClubSettingsSeed } from "../molecules/ClubSettingsDialog";

const seed: ClubSettingsSeed = {
  id: "club-a",
  name_pl: "Name",
  name_en: null,
  tagline_pl: null,
  tagline_en: null,
  description_pl: null,
  description_en: null,
  rules_pl: null,
  rules_en: null,
  policy_area: null,
  who_can_post: null,
  join_policy: null,
};
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
beforeEach(() => {
  vi.clearAllMocks();
  h.pending = false;
});

describe("club proposal dialog", () => {
  it("requires a name without sending an empty proposal", () => {
    render(<ClubProposeDialog open onOpenChange={vi.fn()} />);
    change("club.propose.nameLabel", "   ");
    click("club.propose.submit");
    expect(h.propose).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("club.propose.nameRequired");
  });
  it("trims all fields and resets them only after a successful submission", () => {
    const close = vi.fn();
    render(<ClubProposeDialog open onOpenChange={close} />);
    for (const key of ["name", "nameEn", "tagline", "description", "policyArea", "motivation"])
      change(`club.propose.${key}Label`, `  ${key}  `);
    click("club.propose.submit");
    expect(h.propose.mock.calls[0][0]).toEqual({
      name_pl: "name",
      name_en: "nameEn",
      tagline_pl: "tagline",
      description_pl: "description",
      policy_area: "policyArea",
      motivation: "motivation",
    });
    fireEvent.click(screen.getByRole("button", { name: "club.propose.cancel" }));
    expect(close).toHaveBeenCalledWith(false);
    act(() => h.propose.mock.calls[0][1].onSuccess());
    for (const input of screen.getAllByRole("textbox")) expect(input).toHaveValue("");
    expect(h.toast.success).toHaveBeenCalledWith("club.propose.done");
  });
  it("sends absent optional fields as null and preserves the form after an error", () => {
    const close = vi.fn();
    render(<ClubProposeDialog open onOpenChange={close} />);
    change("club.propose.nameLabel", "Name");
    click("club.propose.submit");
    expect(h.propose.mock.calls[0][0]).toEqual({
      name_pl: "Name",
      name_en: null,
      tagline_pl: null,
      description_pl: null,
      policy_area: null,
      motivation: null,
    });
    h.propose.mock.calls[0][1].onError(new Error("unavailable"));
    expect(close).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
    expect(screen.getByLabelText("club.propose.nameLabel")).toHaveValue("Name");
  });
  it("disables inputs and actions while sending", () => {
    h.pending = true;
    render(<ClubProposeDialog open onOpenChange={vi.fn()} />);
    for (const control of [...screen.getAllByRole("textbox"), ...screen.getAllByRole("button")])
      expect(control).toBeDisabled();
  });
});

describe("club settings dialog", () => {
  it.each([null, "invalid", "members"])("uses safe policy defaults for %s", (value) => {
    render(
      <ClubSettingsDialog
        club={{ ...seed, who_can_post: value, join_policy: value === "members" ? "open" : value }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("club.settings.whoCanPostLabel")).toHaveValue(
      value === "members" ? "members" : "moderators",
    );
    expect(screen.getByLabelText("club.settings.joinPolicyLabel")).toHaveValue(
      value === "members" ? "open" : "request",
    );
  });
  it("rejects a whitespace name without writing settings", () => {
    render(<ClubSettingsDialog club={seed} open onOpenChange={vi.fn()} />);
    change("club.settings.nameLabel", "  ");
    click("club.settings.submit");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("adminClubs.create.error.missing_fields");
  });
  it("submits every edited field and selected policy", () => {
    render(<ClubSettingsDialog club={seed} open onOpenChange={vi.fn()} />);
    for (const key of [
      "name",
      "nameEn",
      "tagline",
      "taglineEn",
      "description",
      "descriptionEn",
      "rules",
      "rulesEn",
      "policyArea",
    ])
      change(`club.settings.${key}Label`, `  ${key}  `);
    change("club.settings.whoCanPostLabel", "members");
    change("club.settings.joinPolicyLabel", "open");
    click("club.settings.submit");
    expect(h.save.mock.calls[0][0]).toEqual({
      patch: {
        name_pl: "name",
        name_en: "nameEn",
        tagline_pl: "tagline",
        tagline_en: "taglineEn",
        description_pl: "description",
        description_en: "descriptionEn",
        rules_pl: "rules",
        rules_en: "rulesEn",
        policy_area: "policyArea",
        who_can_post: "members",
        join_policy: "open",
      },
    });
  });
  it.each([true, false])("distinguishes saved from unchanged: %s", (changed) => {
    const close = vi.fn();
    render(<ClubSettingsDialog club={seed} open onOpenChange={close} />);
    click("club.settings.submit");
    expect(h.save.mock.calls[0][0]).toEqual({
      patch: {
        name_pl: "Name",
        name_en: undefined,
        tagline_pl: null,
        tagline_en: null,
        description_pl: null,
        description_en: null,
        rules_pl: null,
        rules_en: null,
        policy_area: null,
        who_can_post: "moderators",
        join_policy: "request",
      },
    });
    h.save.mock.calls[0][1].onSuccess(changed);
    expect(close).toHaveBeenCalledWith(false);
    expect(changed ? h.toast.success : h.toast.info).toHaveBeenCalledWith(
      changed ? "club.settings.done" : "club.settings.noChanges",
    );
  });
  it("keeps existing localized values and reports save errors", () => {
    const club = {
      ...seed,
      name_en: "Name EN",
      tagline_pl: "PL",
      tagline_en: "EN",
      description_pl: "PL",
      description_en: "EN",
      rules_pl: "PL",
      rules_en: "EN",
      policy_area: "EU",
    };
    const close = vi.fn();
    render(<ClubSettingsDialog club={club} open onOpenChange={close} />);
    click("club.settings.submit");
    h.save.mock.calls[0][1].onError(new Error("connection lost"));
    expect(h.toast.error).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("club.settings.nameEnLabel")).toHaveValue("Name EN");
    click("club.settings.cancel");
    expect(close).toHaveBeenCalledWith(false);
  });
  it("locks all controls during a pending write", () => {
    h.pending = true;
    render(<ClubSettingsDialog club={seed} open onOpenChange={vi.fn()} />);
    for (const control of [
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
      ...screen.getAllByRole("button"),
    ])
      expect(control).toBeDisabled();
  });
});
