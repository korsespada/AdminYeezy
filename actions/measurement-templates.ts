'use server'

import crypto from 'node:crypto'
import sharp from 'sharp'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import { uploadToS3 } from '@/lib/s3'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import { decryptProviderApiKey, type AiProviderKind } from '@/lib/ai-providers'
import { runBatchAiOpenRouter, type BatchAiSettings } from '@/lib/batch-ai'
import {
  normalizeMeasurementTable,
  normalizeMeasurementTemplateInput,
  type MeasurementTemplate,
} from '@/lib/measurement-templates'

function rowToTemplate(row: any): MeasurementTemplate | null {
  const measurements = normalizeMeasurementTable(row.measurements)
  if (!measurements) return null
  return {
    id: Number(row.id),
    supplierId: Number(row.supplier_id),
    supplierName: String(row.supplier_name || ''),
    name: String(row.name || ''),
    garmentType: row.garment_type,
    measurements,
    sourceImageUrl: row.source_image_url ? String(row.source_image_url) : null,
    notes: String(row.notes || ''),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  }
}

export async function getMeasurementTemplateSuppliersAction() {
  await requireAdmin()
  try {
    const result = await scrapingQuery('SELECT id,name,album_id FROM suppliers ORDER BY name ASC, id ASC')
    return { success: true, data: result.rows.map((row) => ({ id: Number(row.id), name: String(row.name || ''), albumId: String(row.album_id || '') })) }
  } catch (error: any) {
    return { success: false, error: error.message, data: [] as { id: number; name: string; albumId: string }[] }
  }
}

export async function getMeasurementTemplatesAction(supplierId?: number | null) {
  await requireAdmin()
  try {
    const normalizedSupplierId = Number(supplierId)
    const query = Number.isInteger(normalizedSupplierId) && normalizedSupplierId > 0
      ? `
      SELECT mt.id,mt.supplier_id,s.name AS supplier_name,mt.name,mt.garment_type,mt.measurements,mt.source_image_url,mt.notes,mt.created_at,mt.updated_at
      FROM measurement_templates mt
      JOIN suppliers s ON s.id=mt.supplier_id
      WHERE mt.supplier_id=$1
      ORDER BY mt.garment_type ASC, mt.name ASC, mt.id ASC
    `
      : `
      SELECT mt.id,mt.supplier_id,s.name AS supplier_name,mt.name,mt.garment_type,mt.measurements,mt.source_image_url,mt.notes,mt.created_at,mt.updated_at
      FROM measurement_templates mt
      JOIN suppliers s ON s.id=mt.supplier_id
      ORDER BY s.name ASC,mt.garment_type ASC,mt.name ASC,mt.id ASC
    `
    const result = await scrapingQuery(query, Number.isInteger(normalizedSupplierId) && normalizedSupplierId > 0 ? [normalizedSupplierId] : [])
    return { success: true, data: result.rows.map(rowToTemplate).filter(Boolean) as MeasurementTemplate[] }
  } catch (error: any) {
    return { success: false, error: error.message, data: [] as MeasurementTemplate[] }
  }
}

export async function saveMeasurementTemplateAction(input: {
  id?: unknown
  supplierId?: unknown
  name?: unknown
  garmentType?: unknown
  measurements?: unknown
  sourceImageUrl?: unknown
  notes?: unknown
}) {
  await requireAdmin()
  try {
    const template = normalizeMeasurementTemplateInput(input)
    const result = template.id
      ? await scrapingQuery(`
          UPDATE measurement_templates
          SET supplier_id=$1,name=$2,garment_type=$3,measurements=$4::jsonb,source_image_url=$5,notes=$6,updated_at=NOW()
          WHERE id=$7
          RETURNING id,supplier_id,name,garment_type,measurements,source_image_url,notes,created_at,updated_at
        `, [template.supplierId, template.name, template.garmentType, JSON.stringify(template.measurements), template.sourceImageUrl, template.notes || null, template.id])
      : await scrapingQuery(`
          INSERT INTO measurement_templates(supplier_id,name,garment_type,measurements,source_image_url,notes)
          VALUES($1,$2,$3,$4::jsonb,$5,$6)
          RETURNING id,supplier_id,name,garment_type,measurements,source_image_url,notes,created_at,updated_at
        `, [template.supplierId, template.name, template.garmentType, JSON.stringify(template.measurements), template.sourceImageUrl, template.notes || null])
    const saved = rowToTemplate(result.rows[0])
    if (!saved) throw new Error('Не удалось сохранить шаблон')
    revalidatePath('/admin/measurement-templates')
    return { success: true, data: saved }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function deleteMeasurementTemplateAction(id: number) {
  await requireAdmin()
  try {
    const result = await scrapingQuery('DELETE FROM measurement_templates WHERE id=$1 RETURNING id', [Number(id)])
    if (!result.rowCount) return { success: false, error: 'Шаблон не найден' }
    revalidatePath('/admin/measurement-templates')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function uploadMeasurementTemplateImageAction(formData: FormData) {
  await requireAdmin()
  const file = formData.get('file')
  if (!(file instanceof File)) return { success: false, error: 'Файл не выбран' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { success: false, error: 'Поддерживаются JPG, PNG и WebP' }
  }
  if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
    return { success: false, error: 'Размер скриншота должен быть не больше 12 МБ' }
  }
  try {
    const normalized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(2400, 3200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer()
    const url = await uploadToS3(`measurement-templates/${crypto.randomUUID()}.webp`, normalized, 'image/webp')
    return { success: true, data: { url } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

async function measurementRecognitionSettings(): Promise<BatchAiSettings> {
  const settingsResult = await getBatchAiSettingsAction()
  if (!settingsResult.success || !settingsResult.data) throw new Error('Настройки AI недоступны')
  const settings = settingsResult.data as any
  const provider = String(settings.provider || '')
  if (provider === 'cockpit') throw new Error('Для распознавания таблиц выберите OpenRouter или BYESU в настройках AI')
  if (provider !== 'openrouter' && provider !== 'byesu') throw new Error('Не выбран совместимый AI-провайдер')

  let providerBaseUrl = ''
  let providerApiKey = ''
  if (settings.activeProviderId) {
    const result = await scrapingQuery('SELECT kind,base_url,api_key_ciphertext,model FROM ai_providers WHERE id=$1', [String(settings.activeProviderId)])
    const configured = result.rows[0]
    if (!configured) throw new Error('Выбранный AI-провайдер не найден')
    if (configured.kind !== provider) throw new Error('Настройки AI-провайдера изменились, обновите страницу')
    providerBaseUrl = String(configured.base_url || '')
    providerApiKey = decryptProviderApiKey(String(configured.api_key_ciphertext || ''))
    if (configured.kind === 'openrouter') settings.openrouterModel = String(configured.model || settings.openrouterModel)
    if (configured.kind === 'byesu') settings.byesuModel = String(configured.model || settings.byesuModel)
  }

  return {
    provider: provider as AiProviderKind,
    providerName: '',
    providerId: String(settings.activeProviderId || ''),
    activeProviderId: String(settings.activeProviderId || ''),
    openrouterModel: String(settings.openrouterModel || 'google/gemini-2.5-flash'),
    byesuModel: String(settings.byesuModel || 'gemini-3.1-flash-lite'),
    temperature: 0,
    maxTokens: 3000,
    concurrency: 1,
    systemPrompt: '',
    providerBaseUrl,
    providerApiKey,
  }
}

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

const MEASUREMENT_RECOGNITION_PROMPT = `Ты распознаёшь ТОЛЬКО размерную таблицу на исходном скриншоте. Верни строгий JSON без Markdown: {"unreadable":false,"unit":"см","columns":[{"key":"waist","label":"Талия"}],"rows":[{"size":"S","values":{"waist":"72"}}],"note":""}. Сначала прочитай видимую сетку: размеры в её шапке становятся rows, названия строк слева становятся columns. Количество rows и columns обязано точно совпадать с количеством видимых размеров и строк сетки. Переписывай только текст и числа, которые действительно видны: не добавляй стандартные размеры, российские размеры в скобках, параметры тела, диапазоны или типовые таблицы одежды. Десятичные значения сохраняй точно. В values допускается только одно точное значение из ячейки, без единиц и диапазонов. Текст вне сетки, включая «ручное измерение», «допуск/погрешность 1–2 см», «±1–2 см» и аналогичные указания, переноси целиком в note. Например, при ячейке «86» и подписи «погрешность 1–2 см» верни values: {"waist":"86"}, note: "Допуск ручного измерения: 1–2 см"; никогда не возвращай «86–90 см» в values. Если сетка или текст не читаются достаточно уверенно, верни только {"unreadable":true} — не угадывай и не подставляй примерную таблицу.`

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

export async function recognizeMeasurementTemplateAction(sourceImageUrl: string) {
  await requireAdmin()
  const imageUrl = String(sourceImageUrl || '').trim()
  if (!/^https?:\/\//i.test(imageUrl)) return { success: false, error: 'Сначала загрузите скриншот таблицы' }
  try {
    const settings = await measurementRecognitionSettings()
    const visionImage = await measurementRecognitionImageDataUrl(imageUrl)
    const firstOutput = await runBatchAiOpenRouter({
      settings,
      systemPrompt: MEASUREMENT_RECOGNITION_PROMPT,
      userPrompt: 'На оригинальном изображении размерная сетка. Перенеси только видимые размеры, названия строк и точные значения ячеек в JSON. Сверь количество размеров и строк с сеткой перед ответом. Ничего не дополняй по знанию о типовых сетках. Примечание о допуске или ручном измерении пиши только в note.',
      contactSheets: [],
      extraImages: [{
        label: 'Обрезанный и увеличенный фрагмент исходного скриншота с размерной таблицей. Это единственный источник данных.',
        url: visionImage,
        detail: 'high',
      }],
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
      extraImages: [{
        label: 'Обрезанный и увеличенный фрагмент исходного скриншота с размерной таблицей. Это единственный источник данных.',
        url: visionImage,
        detail: 'high',
      }],
    })
    if ((output as any)?.unreadable === true) {
      throw new Error('ИИ не смог подтвердить все ячейки таблицы. Загрузите более чёткий скриншот или заполните её вручную.')
    }
    const measurements = normalizeMeasurementTable((output as any)?.measurements || output)
    if (!measurements) throw new Error('ИИ не вернул распознаваемую таблицу. Проверьте скриншот или заполните таблицу вручную.')
    if (measurementTableCellFingerprint(firstMeasurements) !== measurementTableCellFingerprint(measurements)) {
      throw new Error('ИИ получил разные результаты при повторной проверке. Таблица не была применена — попробуйте другой скриншот или заполните её вручную.')
    }
    return { success: true, data: measurements }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
