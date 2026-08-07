import { supabase } from "@/integrations/supabase/client";
export async function probe() {
  const { data } = await supabase.rpc("admin_club_member_upsert", {
    p_club_id: "a", p_user_id: "b", p_role: "member", p_status: "active",
    p_role_expires_at: undefined, p_clear_role_expiry: false,
  });
  const s: string | null = data;
  return s;
}
