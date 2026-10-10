import { describe, expect, it } from "vitest";
import { collectCustomValues, parseCustomFields, validateCustom } from "../formFields";
import { contactTextSchema } from "@/lib/forms/contactLimits";

describe("full form messages", () => {
  it("accepts 8000 message characters and rejects 8001", () => {
    const payload = { name: "Anna", email: "anna@example.test" };
    expect(contactTextSchema.parse({ ...payload, message: "x".repeat(8000) }).message).toHaveLength(8000);
    expect(contactTextSchema.safeParse({ ...payload, message: "x".repeat(8001) }).success).toBe(false);
  });
  it("does not silently truncate custom field input", () => {
    const fields = parseCustomFields([{ id: "details", type: "textarea", maxLength: 4000 }]);
    const fd = new FormData();
    fd.set("custom_details", "x".repeat(501) + "END");
    const values = collectCustomValues(fields, fd);
    expect(values.details).toBe("x".repeat(501) + "END");
    expect(validateCustom(fields, values, "required", "too long")).toEqual({ details: "too long" });
  });
  it("accepts all 500 characters of a custom field", () => {
    const fields = parseCustomFields([{ id: "details", type: "textarea" }]);
    expect(validateCustom(fields, { details: "x".repeat(500) }, "required", "too long")).toEqual({});
  });
});