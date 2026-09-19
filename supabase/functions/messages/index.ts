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
    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);

    // Find the segment following 'messages' (e.g. /functions/v1/messages/12345 or /messages/12345)
    let externalUserId: string | null = null;
    const messagesIndex = pathSegments.indexOf("messages");

    if (messagesIndex !== -1 && pathSegments.length > messagesIndex + 1) {
      externalUserId = decodeURIComponent(pathSegments[messagesIndex + 1]).trim();
    }

    // Also support query param fallback (?external_user_id=12345 or ?userId=12345)
    if (!externalUserId) {
      externalUserId =
        url.searchParams.get("external_user_id")?.trim() ||
        url.searchParams.get("userId")?.trim() ||
        null;
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false });

    if (externalUserId) {
      query = query.eq("external_user_id", externalUserId);
    }

    const { data: messages, error } = await query;

    if (error) {
      return errorResponse(error.message, 500);
    }

    return jsonResponse({
      messages: messages ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 500);
  }
});
