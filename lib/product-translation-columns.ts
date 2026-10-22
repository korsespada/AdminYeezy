type QueryClient = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

// Колонки EN-перевода добавляет `npm run db:migrate:scraping`. Пока миграции нет,
// запись товара идёт без EN-полей, а не падает на каждом товаре.
// Кэшируется только положительный ответ: после миграции колонки подхватятся без рестарта.
let translationColumnsReady = false

export async function hasProductTranslationColumns(client: QueryClient) {
  if (translationColumnsReady) return true
  const result = await client.query(`
    SELECT COUNT(*)::int AS count FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'products' AND column_name IN ('translations', 'photo_alts_en')
  `)
  translationColumnsReady = Number(result.rows[0]?.count) === 2
  if (!translationColumnsReady) console.warn('[batch-ai] translations/photo_alts_en columns are missing: run npm run db:migrate:scraping')
  return translationColumnsReady
}
