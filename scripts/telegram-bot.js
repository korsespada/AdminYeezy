const { Telegraf, Markup } = require('telegraf');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

const {
  getBatch,
  getBatchProducts,
  getLatestBatches,
  listAllSuppliers,
  listFavoriteSuppliers,
  processBatchWithAi,
  pushBatchToCatalog,
  runBatchPostProcessScript,
  startScraping,
} = require('./batch-workflow');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

const proxy = process.env.BOT_PROXY;
const botOptions = {};
if (proxy) {
  console.log('Using proxy:', proxy);
  botOptions.telegram = { agent: new HttpsProxyAgent(proxy) };
}

const bot = new Telegraf(token, botOptions);
const AUTHORIZED_IDS = process.env.MANAGER_CHAT_ID?.split(',').map((id) => id.trim()).filter(Boolean) || [];
const adminBaseUrl = (process.env.ADMIN_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

function adminBatchUrl() {
  return `${adminBaseUrl}/admin/batches`;
}

function adminProductUrl(product) {
  const search = encodeURIComponent(product.external_id || product.name || '');
  return `${adminBaseUrl}/admin?search=${search}`;
}

function stageLabel(stage) {
  const labels = {
    SCRAPED: 'Собрано',
    AI_PROCESSED: 'Обработано ИИ',
    PUSHED: 'Запушено',
    DELETED_FROM_DB: 'Удалено из БД',
  };
  return labels[stage] || stage || 'Собрано';
}

function periodToDate(period) {
  if (period === 'all') return null;
  const days = Number(period);
  if (!Number.isFinite(days) || days <= 0) return null;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function mainMenuMarkup() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📦 Выгрузить товары', 'export:favorites')],
    [Markup.button.callback('⭐ Избранные поставщики', 'export:favorites')],
    [Markup.button.callback('🗂 История выгрузок', 'history')],
    [Markup.button.callback('🆘 Помощь', 'help')],
  ]);
}

function batchActionsMarkup(batchId, page = 0) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🤖 Обработать ИИ', `ai:${batchId}`),
      Markup.button.callback('🧰 Скрипт', `script:${batchId}`),
    ],
    [
      Markup.button.callback('👀 Товары', `products:${batchId}:${page}`),
      Markup.button.callback('🚀 Пуш', `push:${batchId}`),
    ],
    [Markup.button.url('Открыть в админке', adminBatchUrl())],
    [Markup.button.callback('🔙 История', 'history')],
  ]);
}

async function safeEditOrReply(ctx, text, markup) {
  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, markup);
    } catch {
      return ctx.reply(text, markup);
    }
  }
  return ctx.reply(text, markup);
}

bot.use(async (ctx, next) => {
  const chatId = ctx.from?.id?.toString();
  if (AUTHORIZED_IDS.length > 0 && !AUTHORIZED_IDS.includes(chatId)) {
    console.log(`Unauthorized access attempt from ID: ${chatId}`);
    return;
  }
  return next();
});

async function sendMainMenu(ctx) {
  return safeEditOrReply(ctx, '🎛 Главное меню управления выгрузками:', mainMenuMarkup());
}

async function showSuppliers(ctx, onlyFavorites = true) {
  const suppliers = onlyFavorites ? await listFavoriteSuppliers() : await listAllSuppliers();

  if (suppliers.length === 0 && onlyFavorites) {
    return safeEditOrReply(
      ctx,
      '⭐ Избранных поставщиков пока нет.\n\nОтметьте поставщиков звездочкой в админке или откройте полный список.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Показать всех поставщиков', 'export:all')],
        [Markup.button.callback('🔙 Назад', 'menu')],
      ]),
    );
  }

  if (suppliers.length === 0) {
    return safeEditOrReply(
      ctx,
      '⚠️ Поставщиков пока нет. Добавьте их в админке.',
      Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'menu')]]),
    );
  }

  const buttons = suppliers.map((supplier) => [Markup.button.callback(supplier.name, `supplier:${supplier.id}`)]);
  if (onlyFavorites) buttons.push([Markup.button.callback('Показать всех', 'export:all')]);
  buttons.push([Markup.button.callback('🔙 Назад', 'menu')]);

  return safeEditOrReply(
    ctx,
    onlyFavorites ? '⭐ Выберите поставщика из избранного:' : 'Выберите поставщика:',
    Markup.inlineKeyboard(buttons),
  );
}

async function showPeriodPicker(ctx, supplierId) {
  return safeEditOrReply(ctx, 'За какой период выгрузить товары?', Markup.inlineKeyboard([
    [Markup.button.callback('7 дней', `period:${supplierId}:7`), Markup.button.callback('30 дней', `period:${supplierId}:30`)],
    [Markup.button.callback('60 дней', `period:${supplierId}:60`), Markup.button.callback('90 дней', `period:${supplierId}:90`)],
    [Markup.button.callback('Все время', `period:${supplierId}:all`)],
    [Markup.button.callback('🔙 Поставщики', 'export:favorites')],
  ]));
}

async function showHistory(ctx) {
  const batches = await getLatestBatches(10);
  if (batches.length === 0) {
    return safeEditOrReply(ctx, 'История выгрузок пока пустая.', Markup.inlineKeyboard([
      [Markup.button.callback('📦 Выгрузить товары', 'export:favorites')],
      [Markup.button.callback('🔙 Назад', 'menu')],
    ]));
  }

  const buttons = batches.map((batch) => [
    Markup.button.callback(
      `${stageLabel(batch.stage)} · ${batch.supplier_name || batch.name} · ${batch.items_count || 0} шт.`,
      `batch:${batch.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('🔄 Обновить', 'history'), Markup.button.callback('🔙 Назад', 'menu')]);

  return safeEditOrReply(ctx, '🗂 Последние выгрузки:', Markup.inlineKeyboard(buttons));
}

async function showBatch(ctx, batchId) {
  const batch = await getBatch(batchId);
  if (!batch) {
    return safeEditOrReply(ctx, 'Выгрузка не найдена.', Markup.inlineKeyboard([[Markup.button.callback('🔙 История', 'history')]]));
  }

  const text = [
    `📦 ${batch.name || 'Выгрузка'}`,
    `Поставщик: ${batch.supplier_name || '—'}`,
    `Товаров: ${batch.items_count || 0}`,
    `Статус: ${stageLabel(batch.stage)}`,
    `ID: ${batch.id}`,
  ].join('\n');

  return safeEditOrReply(ctx, text, batchActionsMarkup(batch.id));
}

async function showProducts(ctx, batchId, page = 0) {
  const limit = 5;
  const products = await getBatchProducts(batchId, limit, page * limit);
  const batch = await getBatch(batchId);

  if (products.length === 0) {
    return safeEditOrReply(ctx, 'В этой выгрузке нет товаров на выбранной странице.', batchActionsMarkup(batchId, Math.max(0, page - 1)));
  }

  const lines = products.map((product, index) => {
    const title = product.name || 'Без названия';
    const price = product.price ? `${Number(product.price).toLocaleString('ru-RU')} ₽` : 'цена не задана';
    return `${page * limit + index + 1}. ${title}\n${price} · ${product.external_id || 'без артикула'}\n${adminProductUrl(product)}`;
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('← Назад', `products:${batchId}:${page - 1}`));
  if (products.length === limit) nav.push(Markup.button.callback('Дальше →', `products:${batchId}:${page + 1}`));

  const buttons = [];
  if (nav.length) buttons.push(nav);
  buttons.push([Markup.button.callback('🚀 Пуш', `push:${batchId}`), Markup.button.callback('⚙️ Действия', `batch:${batchId}`)]);
  buttons.push([Markup.button.url('Открыть в админке', adminBatchUrl())]);

  return safeEditOrReply(
    ctx,
    `👀 Товары ${batch?.supplier_name || ''}\n\n${lines.join('\n\n')}`,
    Markup.inlineKeyboard(buttons),
  );
}

async function handleCompletedExport(chatId, result) {
  if (result.status !== 'Сырой CSV' || !result.batchId) {
    await bot.telegram.sendMessage(
      chatId,
      `❌ Ошибка выгрузки\nПоставщик: ${result.supplier.name}\nЗадача: #${result.taskId}\n${result.error || ''}`,
    );
    return;
  }

  await bot.telegram.sendMessage(
    chatId,
    [
      '✅ Выгрузка завершена',
      `Поставщик: ${result.supplier.name}`,
      `Задача: #${result.taskId}`,
      `Товаров: ${result.itemsCount}`,
      '',
      'Теперь можно обработать ИИ/скриптом, посмотреть товары или запушить в каталог.',
    ].join('\n'),
    batchActionsMarkup(result.batchId),
  );
}

bot.start((ctx) => sendMainMenu(ctx));
bot.command('menu', (ctx) => sendMainMenu(ctx));
bot.command('suppliers', (ctx) => showSuppliers(ctx, true));
bot.command('history', (ctx) => showHistory(ctx));

bot.action('menu', async (ctx) => {
  await ctx.answerCbQuery();
  return sendMainMenu(ctx);
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  return safeEditOrReply(
    ctx,
    'Бот ведет выгрузку по шагам:\n1. Выберите поставщика из избранного.\n2. Выберите период.\n3. Дождитесь завершения.\n4. Обработайте ИИ или скриптом.\n5. Проверьте товары и нажмите пуш.',
    Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'menu')]]),
  );
});

bot.action('history', async (ctx) => {
  await ctx.answerCbQuery();
  return showHistory(ctx);
});

bot.action('export:favorites', async (ctx) => {
  await ctx.answerCbQuery();
  return showSuppliers(ctx, true);
});

bot.action('export:all', async (ctx) => {
  await ctx.answerCbQuery();
  return showSuppliers(ctx, false);
});

bot.action(/supplier:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  return showPeriodPicker(ctx, Number(ctx.match[1]));
});

bot.action(/period:(\d+):(.+)/, async (ctx) => {
  const supplierId = Number(ctx.match[1]);
  const period = ctx.match[2];
  const endDate = periodToDate(period);
  await ctx.answerCbQuery('Запускаю выгрузку');

  const started = await startScraping(supplierId, endDate, undefined, undefined, (result) => handleCompletedExport(ctx.chat.id, result));
  return safeEditOrReply(
    ctx,
    `🚀 Выгрузка запущена\nПоставщик: ${started.supplierName}\nЗадача: #${started.taskId}\nПериод до: ${endDate || 'все время'}\n\nЯ пришлю кнопки действий, когда сбор завершится.`,
    Markup.inlineKeyboard([[Markup.button.callback('🗂 История', 'history')]]),
  );
});

bot.action(/batch:([0-9a-f-]+)/, async (ctx) => {
  await ctx.answerCbQuery();
  return showBatch(ctx, ctx.match[1]);
});

bot.action(/products:([0-9a-f-]+):(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  return showProducts(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/ai:([0-9a-f-]+)/, async (ctx) => {
  const batchId = ctx.match[1];
  await ctx.answerCbQuery('ИИ обработка запущена');
  await safeEditOrReply(ctx, '🤖 Обрабатываю товары с ИИ. Это может занять несколько минут.', Markup.inlineKeyboard([
    [Markup.button.callback('🗂 История', 'history')],
  ]));

  try {
    const result = await processBatchWithAi(batchId);
    await bot.telegram.sendMessage(
      ctx.chat.id,
      `✅ ИИ обработка завершена\nОбработано: ${result.processed}\nВсего товаров: ${result.total}`,
      batchActionsMarkup(batchId),
    );
  } catch (error) {
    await bot.telegram.sendMessage(ctx.chat.id, `❌ Ошибка ИИ обработки:\n${error.message}`, batchActionsMarkup(batchId));
  }
});

bot.action(/script:([0-9a-f-]+)/, async (ctx) => {
  const batchId = ctx.match[1];
  await ctx.answerCbQuery('Скрипт запущен');
  await safeEditOrReply(ctx, '🧰 Запускаю постобработку скриптом.', Markup.inlineKeyboard([
    [Markup.button.callback('🗂 История', 'history')],
  ]));

  try {
    const result = await runBatchPostProcessScript(batchId);
    await bot.telegram.sendMessage(
      ctx.chat.id,
      `✅ Скрипт постобработки завершен\nТоваров: ${result.processed}`,
      batchActionsMarkup(batchId),
    );
  } catch (error) {
    await bot.telegram.sendMessage(ctx.chat.id, `❌ Ошибка скрипта:\n${error.message}`, batchActionsMarkup(batchId));
  }
});

bot.action(/push:([0-9a-f-]+)/, async (ctx) => {
  const batchId = ctx.match[1];
  await ctx.answerCbQuery('Пуш запущен');
  await safeEditOrReply(ctx, '🚀 Пушу товары в каталог. Пришлю итог после завершения.', Markup.inlineKeyboard([
    [Markup.button.callback('🗂 История', 'history')],
  ]));

  let lastNotified = 0;
  try {
    const result = await pushBatchToCatalog(batchId, async ({ current, total }) => {
      if (current === total || current - lastNotified >= 25) {
        lastNotified = current;
        await bot.telegram.sendMessage(ctx.chat.id, `Пуш: ${current}/${total}`);
      }
    });

    const errorText = result.failed > 0 ? `\nОшибок: ${result.failed}\n${result.errors.slice(0, 5).join('\n')}` : '';
    await bot.telegram.sendMessage(
      ctx.chat.id,
      `✅ Пуш завершен\nУспешно: ${result.success}/${result.total}${errorText}`,
      batchActionsMarkup(batchId),
    );
  } catch (error) {
    await bot.telegram.sendMessage(ctx.chat.id, `❌ Ошибка пуша:\n${error.message}`, batchActionsMarkup(batchId));
  }
});

bot.catch((error, ctx) => {
  console.error('Telegram bot error:', error);
  if (ctx?.chat?.id) {
    ctx.reply(`❌ Ошибка: ${error.message || 'unknown error'}`).catch(console.error);
  }
});

bot.launch();
console.log('Telegram bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
