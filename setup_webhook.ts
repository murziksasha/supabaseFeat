#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * setup_webhook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Регистрирует Telegram Webhook на Supabase Edge Function.
 *
 * Использование:
 *   deno run --allow-net --allow-env setup_webhook.ts <BOT_TOKEN> [--delete]
 *
 * Аргументы:
 *   <BOT_TOKEN>   Токен Telegram-бота (обязателен)
 *   --delete      Удалить существующий вебхук (сбросить настройки)
 *   --info        Показать информацию о текущем вебхуке
 *
 * Примеры:
 *   npm run webhook:setup -- 123456789:ABCdef...
 *   npm run webhook:delete -- 123456789:ABCdef...
 *   npm run webhook:info -- 123456789:ABCdef...
 */

const SUPABASE_FUNCTION_URL =
  "https://hdnildwzmoqldghjcscr.supabase.co/functions/v1/userIncubatorId";

const args = Deno.args;
const botToken = args[0];
const action = args.includes("--delete")
  ? "delete"
  : args.includes("--info")
  ? "info"
  : "set";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function printUsage() {
  console.log(`
📋 Использование:
  npm run webhook:setup -- <BOT_TOKEN>   # Установить вебхук
  npm run webhook:delete -- <BOT_TOKEN>  # Удалить вебхук
  npm run webhook:info -- <BOT_TOKEN>    # Информация о вебхуке

💡 Или используйте готовые ссылки в браузере:
  Установить : https://api.telegram.org/bot<TOKEN>/setWebhook?url=${SUPABASE_FUNCTION_URL}
  Удалить    : https://api.telegram.org/bot<TOKEN>/deleteWebhook
  Информация : https://api.telegram.org/bot<TOKEN>/getWebhookInfo
`);
}

async function tgApi(
  token: string,
  method: string,
  body?: Record<string, unknown>,
) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return await res.json();
}

// ─── Validate token ────────────────────────────────────────────────────────────
if (!botToken || botToken.startsWith("--")) {
  console.error("❌ Ошибка: BOT_TOKEN не указан.\n");
  printUsage();
  Deno.exit(1);
}

// ─── Get bot info ──────────────────────────────────────────────────────────────
console.log("🤖 Получение информации о боте...");
const meResult = await tgApi(botToken, "getMe");
if (!meResult.ok) {
  console.error(
    `❌ Ошибка авторизации: ${meResult.description ?? "Неверный токен"}`,
  );
  Deno.exit(1);
}

const bot = meResult.result;
console.log(`✅ Бот: @${bot.username} (id: ${bot.id})`);

// ─── Execute action ────────────────────────────────────────────────────────────
if (action === "info") {
  console.log("\n📡 Текущая конфигурация вебхука:");
  const info = await tgApi(botToken, "getWebhookInfo");
  const w = info.result;
  if (!w.url) {
    console.log("  ⚠️  Вебхук не установлен.");
  } else {
    console.log(`  URL              : ${w.url}`);
    console.log(`  Pending updates  : ${w.pending_update_count}`);
    console.log(`  Max connections  : ${w.max_connections}`);
    console.log(
      `  Allowed updates  : ${(w.allowed_updates ?? ["all"]).join(", ")}`,
    );
    if (w.last_error_message) {
      console.log(`  ⚠️  Последняя ошибка: ${w.last_error_message}`);
    } else {
      console.log("  ✅ Ошибок нет");
    }
  }
} else if (action === "delete") {
  console.log("\n🗑️  Удаление вебхука...");
  const result = await tgApi(botToken, "deleteWebhook");
  if (result.ok) {
    console.log("✅ Вебхук успешно удалён!");
    console.log(
      `\n💡 Теперь бот вернётся в режим polling (getUpdates).\n` +
        `   Чтобы снова использовать Supabase — запустите:\n` +
        `   npm run webhook:setup -- ${botToken}`,
    );
  } else {
    console.error(`❌ Ошибка: ${result.description}`);
    Deno.exit(1);
  }
} else {
  // action === "set"
  console.log(`\n🔗 Регистрация вебхука на:\n   ${SUPABASE_FUNCTION_URL}\n`);

  const result = await tgApi(botToken, "setWebhook", {
    url: SUPABASE_FUNCTION_URL,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });

  if (result.ok) {
    console.log("✅ Вебхук успешно зарегистрирован!");
    console.log(`\n🎉 Готово! Теперь каждое сообщение боту @${bot.username}`);
    console.log(`   будет доставляться напрямую в Supabase Edge Function.`);
    console.log(`\n📌 Следующий шаг — добавьте токен как секрет Supabase:`);
    console.log(`   npx supabase secrets set TELEGRAM_BOT_TOKEN=${botToken}`);
    console.log(`   npm run deploy:userIncubatorId`);
    console.log(
      `\n🔍 Проверить статус вебхука:\n   npm run webhook:info -- ${botToken}`,
    );
  } else {
    console.error(`❌ Ошибка: ${result.description}`);
    console.log(
      "\n💡 Убедитесь, что Edge Function задеплоена:\n   npm run deploy:userIncubatorId",
    );
    Deno.exit(1);
  }
}
