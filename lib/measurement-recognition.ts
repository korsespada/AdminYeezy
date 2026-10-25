import sharp from 'sharp'
import { runBatchAiOpenRouter, type BatchAiSettings } from '@/lib/batch-ai'
import { normalizeMeasurementTable, type MeasurementTable } from '@/lib/measurement-templates'

// Распознавание одной размерной таблицы по картинке. Им пользуются библиотека
// шаблонов замеров и цветовые семьи: одна картинка сетки у нескольких цветов
// читается один раз и записывается всем.

const MEASUREMENT_RECOGNITION_PROMPT = `Ты распознаёшь ТОЛЬКО размерную таблицу на исходном скриншоте. Верни строгий JSON без Markdown: {"unreadable":false,"unit":"см","columns":[{"key":"waist","label":"Талия"}],"rows":[{"size":"S","values":{"waist":"72"}}],"note":""}. Сначала прочитай видимую сетку: размеры в её шапке становятся rows, названия строк слева становятся columns. Количество rows и columns обязано точно совпадать с количеством видимых размеров и строк сетки. Переписывай только текст и числа, которые действительно видны: не добавляй стандартные размеры, российские размеры в скобках, параметры тела, диапазоны или типовые таблицы одежды. Десятичные значения сохраняй точно. В values допускается только одно точное значение из ячейки, без единиц и диапазонов. Текст вне сетки, включая «ручное измерение», «допуск/погрешность 1–2 см», «±1–2 см» и аналогичные указания, переноси целиком в note. Например, при ячейке «86» и подписи «погрешность 1–2 см» верни values: {"waist":"86"}, note: "Допуск ручного измерения: 1–2 см"; никогда не возвращай «86–90 см» в values. Если сетка или текст не читаются достаточно уверенно, верни только {"unreadable":true} — не угадывай и не подставляй примерную таблицу.`

async function measurementRecognitionImageDataUrl(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Не удалось получить скриншот таблицы (${response.status})`)
  const source = Buffer.from(await response.arrayBuffer())
  if (!source.length || source.length > 12 * 1024 * 1024) {
    throw new Error('Скриншот таблицы слишком большой или пустой')
  }

  // В исходном мобильном скриншоте таблица часто занимает лишь небольшую часть
  // белого полотна. Обрезаем поля и увеличиваем именно таблицу перед отправкой
  // в vision-модель, чтобы она не видела её как нечитаемую миниатюру.
  const prepared = await sharp(source)
    .rotate()
    .trim({ background: '#ffffff', threshold: 16 })
    .resize(2400, 2400, { fit: 'inside', withoutEnlargement: false })
    .webp({ quality: 96, smartSubsample: false })
    .toBuffer()
  return `data:image/webp;base64,${prepared.toString('base64')}`
}

function measurementTableCellFingerprint(value: unknown) {
  const table = normalizeMeasurementTable(value)
  if (!table) return null
  return JSON.stringify({
    columnCount: table.columns.length,
    rows: table.rows.map((row) => ({
      size: row.size.trim().toLocaleLowerCase('ru-RU'),
      values: table.columns.map((column) => String(row.values[column.key] || '').trim()),
    })),
  })
}

/**
 * Читает таблицу дважды независимыми запросами и возвращает её, только если
 * оба прочтения совпали по каждой ячейке. Иначе бросает понятную ошибку.
 */
export async function recognizeMeasurementImage(imageUrl: string, providerSettings: BatchAiSettings): Promise<MeasurementTable> {
  const settings: BatchAiSettings = { ...providerSettings, temperature: 0, maxTokens: 3000, systemPrompt: '' }
  const visionImage = await measurementRecognitionImageDataUrl(imageUrl)
  const image = [{
    label: 'Обрезанный и увеличенный фрагмент исходного скриншота с размерной таблицей. Это единственный источник данных.',
    url: visionImage,
    detail: 'high' as const,
  }]
  const firstOutput = await runBatchAiOpenRouter({
    settings,
    systemPrompt: MEASUREMENT_RECOGNITION_PROMPT,
    userPrompt: 'На оригинальном изображении размерная сетка. Перенеси только видимые размеры, названия строк и точные значения ячеек в JSON. Сверь количество размеров и строк с сеткой перед ответом. Ничего не дополняй по знанию о типовых сетках. Примечание о допуске или ручном измерении пиши только в note.',
    contactSheets: [],
    extraImages: image,
  })
  if ((firstOutput as any)?.unreadable === true) {
    throw new Error('ИИ не смог уверенно прочитать таблицу. Загрузите более чёткий скриншот или заполните её вручную.')
  }
  const firstMeasurements = (firstOutput as any)?.measurements || firstOutput
  if (!measurementTableCellFingerprint(firstMeasurements)) {
    throw new Error('ИИ не вернул распознаваемую таблицу. Проверьте скриншот или заполните таблицу вручную.')
  }

  const output = await runBatchAiOpenRouter({
    settings,
    systemPrompt: `${MEASUREMENT_RECOGNITION_PROMPT}\n\nЭто независимая контрольная проверка: предыдущий ответ тебе не известен. Самостоятельно прочитай каждую строку, заголовок и ячейку только по изображению. Если хотя бы один размер, параметр или номер ячейки нельзя подтвердить, верни только {"unreadable":true}.`,
    userPrompt: 'Независимо распознай размерную таблицу на изображении. Не используй типовые сетки и не дополняй отсутствующие данные.',
    contactSheets: [],
    extraImages: image,
  })
  if ((output as any)?.unreadable === true) {
    throw new Error('ИИ не смог подтвердить все ячейки таблицы. Загрузите более чёткий скриншот или заполните её вручную.')
  }
  const measurements = normalizeMeasurementTable((output as any)?.measurements || output)
  if (!measurements) throw new Error('ИИ не вернул распознаваемую таблицу. Проверьте скриншот или заполните таблицу вручную.')
  if (measurementTableCellFingerprint(firstMeasurements) !== measurementTableCellFingerprint(measurements)) {
    throw new Error('ИИ получил разные результаты при повторной проверке. Таблица не была применена — попробуйте другой скриншот или заполните её вручную.')
  }
  return measurements
}
