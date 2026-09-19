import { Bot } from "npm:grammy@^1.35.0";

const EDGE_URL =
  "https://hdnildwzmoqldghjcscr.supabase.co/functions/v1/userIncubatorId";

// Читаем токен из аргументов командной строки или переменной окружения
let token = Deno.args[0] || Deno.env.get("BOT_TOKEN")?.trim();

if (!token) {
  const input = prompt("Введите токен вашего Telegram-бота (от @BotFather):");
  token = input?.trim() || "";
}

if (!token) {
  console.error(
    "❌ Ошибка: Токен бота не указан. Запустите: deno run -A test_bot.ts <ВАШ_ТОКЕН>",
  );
  Deno.exit(1);
}

// Проверяем статус вебхука перед запуском long-polling
try {
  const webhookRes = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
  );
  const webhookData = await webhookRes.json();
  if (webhookData.ok && webhookData.result.url) {
    console.warn(
      `⚠️ Внимание: У этого бота установлен активный вебхук: ${webhookData.result.url}`,
    );
    console.warn(
      "Telegram не разрешает одновременно использовать webhook и polling.",
    );
    const shouldDelete = confirm(
      "Удалить вебхук у этого бота для локального теста?",
    );
    if (shouldDelete) {
      await fetch(
        `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`,
      );
      console.log("✅ Вебхук удален. Запускаем опрос...");
    } else {
      console.log(
        "❌ Отменено. Создайте отдельного тестового бота через @BotFather, чтобы не затронуть рабочий вебхук.",
      );
      Deno.exit(0);
    }
  }
} catch (e) {
  console.error("Не удалось проверить статус вебхука:", e);
}

const bot = new Bot(token);

bot.on("message:text", async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username
    ? `@${ctx.from.username}`
    : (ctx.from.first_name || "Unknown");
  const text = ctx.message.text;

  console.log(
    `\n📨 [Telegram] Сообщение от ${username} (id: ${userId}): "${text}"`,
  );

  try {
    console.log(`⏳ Отправка в Supabase Edge Function...`);
    const startTime = performance.now();

    const response = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: userId,
        text: text,
      }),
    });

    const elapsed = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Статус ${response.status}: ${errText}`);
    }

    const data = await response.json();
    console.log(`✅ [Supabase] Ответ за ${elapsed}ms:`, {
      clientId: data.clientId,
      userId: data.userId,
      message: data.message,
      timestamp: data.timestamp,
    });

    // Отправляем сгенерированный ботом ответ обратно в Telegram
    await ctx.reply(data.message);
    console.log(
      `📤 [Telegram] Ответ успешно отправлен пользователю: "${data.message}"`,
    );
  } catch (error) {
    console.error("❌ Ошибка при обращении к Supabase:", error);
    await ctx.reply("Произошла ошибка при обращении к Supabase Edge Function.");
  }
});

console.log("🤖 Запуск Telegram-бота...");
const me = await bot.api.getMe();
console.log(`\n🎉 Бот @${me.username} успешно подключен!`);
console.log(
  `👉 Откройте Telegram, найдите https://t.me/${me.username} и отправьте любое сообщение.`,
);
console.log(`   (Нажмите Ctrl+C в консоли для остановки бота)\n`);

bot.start();
