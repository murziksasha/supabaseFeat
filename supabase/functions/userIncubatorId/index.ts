import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/response.ts";
import { getSupabaseClient } from "../_shared/supabaseClient.ts";

// ─── Telegram types ────────────────────────────────────────────────────────────
interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

// ─── Helper: send Telegram message ────────────────────────────────────────────
async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  parseMode?: "HTML" | "Markdown",
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Telegram] sendMessage failed: ${err}`);
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method Not Allowed", 405);
  }

  // ── Detect request source ────────────────────────────────────────────────────
  // Telegram sends: { update_id, message: { from, text, chat, ... } }
  // Legacy API sends: { userId, text }
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const isTelegramUpdate = "update_id" in rawBody;

  // ── Parse fields depending on source ────────────────────────────────────────
  let userId: string;
  let text: string;
  let chatId: number | null = null;
  let username: string | undefined;

  if (isTelegramUpdate) {
    const update = rawBody as unknown as TelegramUpdate;
    const msg = update.message ?? update.callback_query?.message;
    const from = update.message?.from ?? update.callback_query?.from;

    if (!from) {
      // Silently acknowledge unknown update types (Telegram expects 200)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    userId = String(from.id);
    text = update.message?.text ?? update.callback_query?.data ?? "";
    chatId = msg?.chat.id ?? from.id;
    username = from.username;

    if (!text.trim()) {
      // Non-text update (sticker, voice, etc.) — acknowledge without processing
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    // Legacy JSON format: { userId, text }
    const { userId: uid, text: t } = rawBody as {
      userId?: unknown;
      text?: unknown;
    };
    if (
      typeof uid !== "string" ||
      !uid.trim() ||
      typeof t !== "string" ||
      !t.trim()
    ) {
      return errorResponse("Missing or invalid userId or text", 400);
    }
    userId = uid.trim();
    text = t.trim();
  }

  const cleanUserId = userId.trim();
  const cleanText = text.trim();

  // ── DB operations ────────────────────────────────────────────────────────────
  try {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    // Find or create client
    let { data: client, error: clientFetchError } = await supabase
      .from("clients")
      .select("*")
      .eq("external_user_id", cleanUserId)
      .maybeSingle();

    if (clientFetchError) {
      return errorResponse(clientFetchError.message, 500);
    }

    if (!client) {
      const { data: newClient, error: insertClientError } = await supabase
        .from("clients")
        .insert({
          external_user_id: cleanUserId,
          last_message_at: now,
        })
        .select()
        .single();

      if (insertClientError || !newClient) {
        return errorResponse(
          insertClientError?.message ?? "Failed to create client",
          500,
        );
      }
      client = newClient;
    }

    // Insert incoming user message
    const { error: clientMsgError } = await supabase.from("messages").insert({
      client_id: client.id,
      external_user_id: cleanUserId,
      direction: "client",
      body: cleanText,
      created_at: now,
    });

    if (clientMsgError) {
      return errorResponse(clientMsgError.message, 500);
    }

    // ── Generate bot reply ─────────────────────────────────────────────────────
    const displayName = username
      ? `@${username}`
      : `пользователь ${cleanUserId}`;
    const botMessageText = `Привет, ${displayName}! Ты написал: «${cleanText}»`;
    const botTimestamp = new Date().toISOString();

    // Persist bot message
    const { error: botMsgError } = await supabase.from("messages").insert({
      client_id: client.id,
      external_user_id: cleanUserId,
      direction: "bot",
      body: botMessageText,
      created_at: botTimestamp,
    });

    if (botMsgError) {
      return errorResponse(botMsgError.message, 500);
    }

    // Update last_message_at
    const { error: updateClientError } = await supabase
      .from("clients")
      .update({ last_message_at: botTimestamp })
      .eq("id", client.id);

    if (updateClientError) {
      return errorResponse(updateClientError.message, 500);
    }

    // ── Send reply to Telegram (only for webhook mode) ────────────────────────
    if (isTelegramUpdate && chatId !== null) {
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (botToken) {
        await sendTelegramMessage(botToken, chatId, botMessageText);
      } else {
        console.warn(
          "[Telegram] TELEGRAM_BOT_TOKEN not set — reply was NOT sent",
        );
      }

      // Telegram expects a 200 OK — return minimal response
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Legacy API response
    return jsonResponse({
      clientId: client.id,
      userId: cleanUserId,
      message: botMessageText,
      timestamp: botTimestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, 500);
  }
});
