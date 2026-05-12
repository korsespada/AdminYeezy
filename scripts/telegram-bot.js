const { Telegraf, Markup } = require('telegraf');
const { Client } = require('pg');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// Настройка прокси
const proxy = process.env.BOT_PROXY;
const botOptions = {};
if (proxy) {
  console.log('Using proxy:', proxy);
  botOptions.telegram = { agent: new HttpsProxyAgent(proxy) };
}

const bot = new Telegraf(process.env.BOT_TOKEN, botOptions);

// DB Client - Используем техническую базу для бота
const db = new Client({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
});

const AUTHORIZED_IDS = process.env.MANAGER_CHAT_ID?.split(',').map(id => id.trim()) || [];

// Middleware для проверки авторизации
bot.use(async (ctx, next) => {
  const chatId = ctx.from?.id.toString();
  if (!AUTHORIZED_IDS.includes(chatId)) {
    console.log(`Unauthorized access attempt from ID: ${chatId}`);
    // Можно отправить сообщение об отсутствии доступа, но лучше просто игнорировать
    return;
  }
  return next();
});

async function connectDB() {
  try {
    await db.connect();
    console.log('Bot connected to DB');
  } catch (err) {
    console.error('DB Connection error:', err);
    process.exit(1);
  }
}

connectDB();

// --- Utils ---

async function notifyTelegram(chatId, supplierName, status, taskId, filePath) {
  const message = status === 'completed' 
    ? `✅ Выгрузка завершена!\nПоставщик: ${supplierName}\nЗадача: #${taskId}\n\nТеперь вы можете проверить товары в админке.`
    : `❌ Ошибка выгрузки!\nПоставщик: ${supplierName}\nЗадача: #${taskId}`;

  await bot.telegram.sendMessage(chatId, message, status === 'completed' ? Markup.inlineKeyboard([
    [Markup.button.url('Открыть в админке', `${process.env.VITE_API_URL}/admin/csv-import?localPath=${encodeURIComponent(filePath)}`)]
  ]) : null);
}

async function startScraping(chatId, supplierId, endDate) {
  try {
    const res = await db.query('SELECT * FROM suppliers WHERE id=$1', [supplierId]);
    const supplier = res.rows[0];
    if (!supplier) return bot.telegram.sendMessage(chatId, 'Поставщик не найден');

    const taskRes = await db.query(
      `INSERT INTO scraping_tasks (supplier_id, status, end_date) VALUES ($1, 'running', $2) RETURNING id`,
      [supplierId, endDate === 'all' ? null : endDate]
    );
    const taskId = taskRes.rows[0].id;

    bot.telegram.sendMessage(chatId, `🚀 Запуск выгрузки для ${supplier.name}...\nID задачи: #${taskId}`);

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const outputFileName = `scrape_${taskId}_${supplier.name.replace(/\s+/g, '_')}.csv`;
    const outputPath = path.join(tmpDir, outputFileName);
    const scriptPath = path.join(process.cwd(), 'scripts', 'parser', 'SzwegoParser.py');

    const args = [
      scriptPath,
      '--album_id', supplier.album_id,
      '--cookie', supplier.cookie,
      '--output', outputPath
    ];
    if (endDate !== 'all') args.push('--end_date', endDate);
    if (supplier.group_id) args.push('--group_id', supplier.group_id);
    if (supplier.tag_id) args.push('--tag_id', supplier.tag_id);

    const pythonProcess = spawn('python', args);

    pythonProcess.on('close', async (code) => {
      const status = code === 0 ? 'completed' : 'failed';
      await db.query(
        `UPDATE scraping_tasks SET status=$1, result_path=$2, updated_at=NOW() WHERE id=$3`,
        [status, code === 0 ? outputPath : null, taskId]
      );
      await notifyTelegram(chatId, supplier.name, status, taskId, outputPath);
    });

  } catch (err) {
    console.error('Bot scraping error:', err);
    bot.telegram.sendMessage(chatId, 'Произошла ошибка при запуске.');
  }
}

// --- Bot Commands ---

function sendMainMenu(ctx) {
  return ctx.reply('🎛 Главное меню управления:', Markup.inlineKeyboard([
    [Markup.button.callback('📦 Список поставщиков', 'menu_suppliers')],
    [Markup.button.callback('📊 История выгрузок', 'menu_history')],
    [Markup.button.callback('🆘 Помощь', 'menu_help')]
  ]));
}

bot.start((ctx) => {
  sendMainMenu(ctx);
});

bot.command('menu', (ctx) => sendMainMenu(ctx));

bot.command('suppliers', async (ctx) => {
  return showSuppliers(ctx);
});

async function showSuppliers(ctx) {
  try {
    const res = await db.query('SELECT id, name FROM suppliers ORDER BY name ASC');
    if (res.rows.length === 0) {
      return ctx.reply('⚠️ Список поставщиков пуст. Добавьте их в админке или попросите администратора.', Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'menu_main')]
      ]));
    }

    const buttons = res.rows.map(s => [Markup.button.callback(s.name, `sup_${s.id}`)]);
    buttons.push([Markup.button.callback('🔙 Назад', 'menu_main')]);
    
    const text = 'Выберите поставщика для запуска выгрузки:';
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
    } else {
        await ctx.reply(text, Markup.inlineKeyboard(buttons));
    }
  } catch (err) {
    ctx.reply('❌ Ошибка при получении списка.');
  }
}

// Callback handlers
bot.action('menu_main', (ctx) => {
  ctx.answerCbQuery();
  return sendMainMenu(ctx);
});

bot.action('menu_suppliers', (ctx) => {
  ctx.answerCbQuery();
  return showSuppliers(ctx);
});

bot.action('menu_history', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Эта функция в разработке. Проверьте историю в админке проекта.', Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Назад', 'menu_main')]
  ]));
});

bot.action('menu_help', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Бот позволяет запускать выгрузку товаров от поставщиков Szwego.\n1. Выберите поставщика\n2. Выберите период\n3. Дождитесь уведомления о готовности', Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Назад', 'menu_main')]
  ]));
});
bot.action(/sup_(\d+)/, (ctx) => {
  const supplierId = ctx.match[1];
  ctx.answerCbQuery();
  ctx.reply('За какой период выгрузить?', Markup.inlineKeyboard([
    [Markup.button.callback('За последние 7 дней', `date_${supplierId}_7`)],
    [Markup.button.callback('За последний месяц', `date_${supplierId}_30`)],
    [Markup.button.callback('Все (до упора)', `date_${supplierId}_all`)]
  ]));
});

bot.action(/date_(\d+)_(.+)/, (ctx) => {
  const supplierId = ctx.match[1];
  const period = ctx.match[2];
  ctx.answerCbQuery();

  let endDate = 'all';
  if (period === '7') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    endDate = d.toISOString().split('T')[0];
  } else if (period === '30') {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    endDate = d.toISOString().split('T')[0];
  }

  startScraping(ctx.chat.id, supplierId, endDate);
});

bot.launch();
console.log('Telegram bot started');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
