// Zapis pionowej pozycji okładki klubu (przesunięcie cover photo w ramce 4:1).
//
// Robimy to na serwerze, bo `cover_position_y` leży w tabeli `clubs` i zmiana
// wymaga uprawnień `can_moderate` do konkretnego klubu - dokładnie tych samych,
// które pilnuje `club_set_cover`. Funkcja RPC `club_set_cover_position` robi
// tę samą weryfikację, więc przekazujemy wartość dalej i zwracamy zapisany
// procent, żeby klient mógł natychmiast zaktualizować UI bez ponownego fetcha.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  clubId: z.string().uuid(),
  positionY: z.number().int().min(0).max(100),
});

export const setClubCoverPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<number> => {
    const { data: result, error } = await context.supabase.rpc("club_set_cover_position", {
      p_club_id: data.clubId,
      p_position_y: data.positionY,
    });
    if (error) throw error;
    return typeof result === "number" ? result : 50;
  });
