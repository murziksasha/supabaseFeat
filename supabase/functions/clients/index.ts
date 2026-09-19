import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/response.ts";
import { getSupabaseClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  if (req.method !== "GET") {
    return errorResponse("Method Not Allowed", 405);
  }

  try {
    const supabase = getSupabaseClient();
    const { data: clients, error } = await supabase
      .from("clients")
      .select("*")
      .order("last_message_at", { ascending: false });

    if (error) {
      return errorResponse(error.message, 500);
    }

    return jsonResponse({
      clients: clients ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 500);
  }
});
