// Server function: persists contact-form submission and (optionally) notifies an inbox.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ContactInput = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  company: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().min(1).max(8000),
  consent: z.boolean(),
  lang: z.enum(["pl", "en"]),
  recipient: z.string().email().max(320).optional(),
});

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((data) => ContactInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("contact_messages").insert({
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      company: data.company ?? null,
      subject: data.subject ?? null,
      message: data.message,
      consent: data.consent,
      lang: data.lang,
      recipient: data.recipient ?? null,
      status: "new",
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
