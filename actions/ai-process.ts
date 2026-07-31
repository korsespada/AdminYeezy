'use server'

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { scrapingQuery } from '@/lib/db'
import { getScrapingFileArtifact } from '@/lib/scraping-files'
import { requireAdmin } from '@/lib/admin-session'
import { isSafeRuntimePath, resolveSafeRuntimePath } from '@/lib/runtime-paths'
import {
  getSupplierAttributeDefinition,
  normalizeSupplierAttributeCodes,
} from '@/lib/supplier-attributes'
import { normalizeProductAttributes } from '@/lib/product-attributes'
import { openRouterChatCompletion } from '@/lib/openrouter'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

const execFileAsync = promisify(execFile)

type TargetedAiEditItem = {
  index: number
  product: any
  previousProduct?: any
  nextProduct?: any
}

type TargetedAiEditLookups = {
  brands?: any[]
  categories?: any[]
  subcategories?: any[]
}

type SourceCsvContext = {
  sourcePath?: string
  byExternalId: Map<string, any>
  rows: any[]
}

type ResolvedSourcePath = {
  filePath: string
  taskId?: number | null
}

const DEFAULT_MODEL = 'google/gemini-2.0-flash-lite:free'

function getWritableTmpDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return os.tmpdir()
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'scratch')
}

async function getAiModelForTargetedEdit(supplierId?: number | null) {
  try {
    if (supplierId) {
      const supplierRes = await scrapingQuery(
        'SELECT ai_photo_models FROM suppliers WHERE id=$1',
        [supplierId],
      )
      const photoModel = supplierRes.rows[0]?.ai_photo_models
      if (photoModel && String(photoModel).trim()) return String(photoModel).trim()
    }

    const modelRes = await scrapingQuery(
      "SELECT value FROM app_settings WHERE key = 'selected_ai_model'",
    )
    return modelRes.rows[0]?.value || DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

async function getSupplierAttributeHints(supplierId?: number | null) {
  if (!supplierId) return []
  try {
    const result = await scrapingQuery(
      'SELECT default_attributes FROM suppliers WHERE id=$1',
      [supplierId],
    )
    const registryDefinitions = await getCatalogAttributeDefinitions()
    const registryByCode = new Map(registryDefinitions.map((item) => [item.code, item]))
    return normalizeSupplierAttributeCodes(result.rows[0]?.default_attributes).map((code) => {
      const supplierDefinition = getSupplierAttributeDefinition(code)
      const definition = registryByCode.get(code) || supplierDefinition
      return {
        code,
        label: definition?.label || code,
        allowed_values: definition?.values || [],
        value_dictionary: definition && 'dictionary_values' in definition
          ? definition.dictionary_values?.filter((item) => item.active).map((item) => ({
            value: item.canonical_value,
            aliases: item.aliases,
          })) || []
          : [],
        description: supplierDefinition?.description || '',
      }
    })
  } catch {
    return []
  }
}

function compactLookup(items: any[] | undefined, extraFields: string[] = []) {
  return (items || []).map((item) => {
    const result: Record<string, any> = {
      id: item.id,
      name: item.name,
    }
    for (const field of extraFields) {
      if (item[field] !== undefined) result[field] = item[field]
    }
    return result
  })
}

function normalizeLookupValue(value: any, items: any[] | undefined) {
  if (value === undefined || value === null) return undefined
  const raw = String(value).trim()
  if (!raw) return ''

  const found = (items || []).find((item) => {
    return item.id === raw || String(item.name).toLowerCase() === raw.toLowerCase()
  })

  return found ? found.id : raw
}

function normalizePatch(rawPatch: any, lookups: TargetedAiEditLookups) {
  const patch: Record<string, any> = {}

  for (const key of ['name', 'description', 'gender']) {
    if (rawPatch?.[key] !== undefined) patch[key] = String(rawPatch[key]).trim()
  }

  if (rawPatch?.price !== undefined) {
    const price = Number(String(rawPatch.price).replace(/[^\d.]/g, ''))
    patch.price = Number.isFinite(price) ? price : 0
  }

  if (rawPatch?.brand !== undefined) {
    patch.brand = normalizeLookupValue(rawPatch.brand, lookups.brands)
  }

  if (rawPatch?.category !== undefined) {
    patch.category = normalizeLookupValue(rawPatch.category, lookups.categories)
  }

  if (rawPatch?.subcategory !== undefined) {
    patch.subcategory = normalizeLookupValue(rawPatch.subcategory, lookups.subcategories)
  }

  if (rawPatch?.attributes && typeof rawPatch.attributes === 'object' && !Array.isArray(rawPatch.attributes)) {
    patch.attributes = normalizeProductAttributes(rawPatch.attributes)
  }

  return patch
}

function parseCsvText(text: string) {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = normalizedText.split('\n')[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ','

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i]
    const nextChar = normalizedText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else if (char === '"' && currentField.trim().length === 0) {
      inQuotes = true
      currentField = ''
    } else if (char === delimiter) {
      currentRow.push(currentField.trim())
      currentField = ''
    } else if (char === '\n') {
      currentRow.push(currentField.trim())
      if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
      currentRow = []
      currentField = ''
    } else {
      currentField += char
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
  }

  if (rows.length === 0) return []
  const headers = rows[0]
  return rows.slice(1).map((values) => {
    const row: Record<string, any> = {}
    headers.forEach((header, index) => {
      const key = header.toLowerCase().trim()
      let value = values[index] || ''
      if (key === 'photos') {
        try {
          value = JSON.parse(value.replace(/""/g, '"'))
        } catch {
          // keep raw value
        }
      }
      row[key] = value
    })
    return row
  })
}

async function resolveSourcePath({
  batchId,
  currentPath,
  sourcePath,
}: {
  batchId?: string | null
  currentPath?: string | null
  sourcePath?: string | null
}): Promise<ResolvedSourcePath | undefined> {
  async function isReadableSource(filePath?: string | null, taskId?: number | null) {
    if (!filePath) return false

    try {
      const artifact = await getScrapingFileArtifact(filePath, taskId)
      if (artifact?.content) return true
    } catch {
      // Fall through to a constrained filesystem read.
    }

    if (!isSafeRuntimePath(filePath)) return false
    return fs.existsSync(/*turbopackIgnore: true*/ resolveSafeRuntimePath(filePath))
  }

  const cleanSourcePath = sourcePath?.replace(/"/g, '')
  if (cleanSourcePath && await isReadableSource(cleanSourcePath)) {
    return { filePath: cleanSourcePath }
  }

  const cleanCurrentPath = currentPath?.replace(/"/g, '')
  if (
    cleanCurrentPath &&
    /task_custom_/i.test(path.basename(cleanCurrentPath)) &&
    await isReadableSource(cleanCurrentPath)
  ) {
    return { filePath: cleanCurrentPath }
  }

  if (batchId) {
    const res = await scrapingQuery(
      `
        SELECT id, result_path, status, created_at
        FROM scraping_tasks
        WHERE batch_id = $1
          AND result_path IS NOT NULL
          AND result_path <> ''
          AND status IN ('Обработано скриптом', 'Сырой CSV', 'Сырой товар')
        ORDER BY
          CASE WHEN status = 'Обработано скриптом' THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 1
      `,
      [batchId],
    )
    for (const row of res.rows) {
      const candidate = row.result_path?.replace(/"/g, '')
      if (candidate && await isReadableSource(candidate, row.id)) {
        return { filePath: candidate, taskId: row.id }
      }
    }
  }

  if (cleanCurrentPath && await isReadableSource(cleanCurrentPath)) {
    return { filePath: cleanCurrentPath }
  }
  return undefined
}

async function loadSourceCsvContext(params: {
  batchId?: string | null
  currentPath?: string | null
  sourcePath?: string | null
}): Promise<SourceCsvContext> {
  const resolved = await resolveSourcePath(params)
  if (!resolved) return { byExternalId: new Map(), rows: [] }

  try {
    let text = ''
    const artifact = await getScrapingFileArtifact(resolved.filePath, resolved.taskId)
    if (artifact?.content) {
      text = artifact.content
    } else {
      text = fs.readFileSync(/*turbopackIgnore: true*/ resolveSafeRuntimePath(resolved.filePath), 'utf-8')
    }

    const rows = parseCsvText(text)
    const byExternalId = new Map<string, any>()
    rows.forEach((row, index) => {
      row.__source_index = index
      if (row.external_id) byExternalId.set(String(row.external_id), row)
    })
    return { sourcePath: resolved.filePath, byExternalId, rows }
  } catch (error) {
    console.warn('[targetedAiEdit] Failed to read source CSV:', error)
    return { sourcePath: resolved.filePath, byExternalId: new Map(), rows: [] }
  }
}

function findSourceProduct(item: TargetedAiEditItem, sourceContext: SourceCsvContext) {
  const externalId = item.product?.external_id
  if (externalId && sourceContext.byExternalId.has(String(externalId))) {
    const sourceProduct = sourceContext.byExternalId.get(String(externalId))
    const sourceIndex = sourceProduct.__source_index
    return {
      sourceProduct,
      previousSourceProduct: sourceIndex > 0 ? sourceContext.rows[sourceIndex - 1] : null,
      nextSourceProduct: sourceIndex + 1 < sourceContext.rows.length ? sourceContext.rows[sourceIndex + 1] : null,
    }
  }

  const sourceProduct = sourceContext.rows[item.index] || null
  return {
    sourceProduct,
    previousSourceProduct: item.index > 0 ? sourceContext.rows[item.index - 1] : null,
    nextSourceProduct: item.index + 1 < sourceContext.rows.length ? sourceContext.rows[item.index + 1] : null,
  }
}

async function runOpenRouterJsonRequest(model: string, content: any[]) {
  const payload = await openRouterChatCompletion({
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })

  const text = payload?.choices?.[0]?.message?.content
  if (!text) throw new Error('ИИ вернул пустой ответ')

  const cleanText = String(text)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleanText)
  } catch {
    const match = cleanText.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Не удалось распарсить JSON от ИИ')
  }
}

export async function targetedAiEditAction({
  instruction,
  items,
  lookups,
  supplierId,
  includePhotos = false,
  batchId,
  currentPath,
  sourcePath,
}: {
  instruction: string
  items: TargetedAiEditItem[]
  lookups: TargetedAiEditLookups
  supplierId?: number | null
  includePhotos?: boolean
  batchId?: string | null
  currentPath?: string | null
  sourcePath?: string | null
}) {
  try {
    await requireAdmin()

    const cleanInstruction = instruction.trim()
    console.log('[targetedAiEdit] start', {
      items: items.length,
      supplierId: supplierId || null,
      batchId: batchId || null,
      currentPath: currentPath ? path.basename(currentPath) : null,
      sourcePath: sourcePath ? path.basename(sourcePath) : null,
      includePhotos,
      instructionLength: cleanInstruction.length,
    })

    if (!cleanInstruction) {
      console.warn('[targetedAiEdit] skipped: empty instruction')
      return { success: false, error: 'Пустой запрос' }
    }

    if (!items.length) {
      console.warn('[targetedAiEdit] skipped: no items')
      return { success: false, error: 'Нет товаров для правки' }
    }

    const model = await getAiModelForTargetedEdit(supplierId)
    const supplierAttributeHints = await getSupplierAttributeHints(supplierId)
    const categories = compactLookup(lookups.categories)
    const subcategories = compactLookup(lookups.subcategories, ['category'])
    const brands = compactLookup(lookups.brands)
    const sourceContext = await loadSourceCsvContext({ batchId, currentPath, sourcePath })
    console.log('[targetedAiEdit] context loaded', {
      model,
      sourcePath: sourceContext.sourcePath ? path.basename(sourceContext.sourcePath) : null,
      sourceRows: sourceContext.rows.length,
      sourceExternalIds: sourceContext.byExternalId.size,
      categories: categories.length,
      subcategories: subcategories.length,
      brands: brands.length,
      supplierAttributes: supplierAttributeHints.length,
    })

    const patches: { index: number; external_id?: string; patch: Record<string, any> }[] = []
    const errors: string[] = []

    const results = await Promise.all(items.map(async (item) => {
      const product = item.product || {}
      const firstPhoto = includePhotos && Array.isArray(product.photos) ? product.photos[0] : null
      const source = findSourceProduct(item, sourceContext)

      const prompt = `
Ты точечно редактируешь одну строку CSV. Измени только поля, которые нужны по запросу пользователя.

Запрос пользователя:
${cleanInstruction}

Правила:
- Верни строго JSON-объект без markdown.
- Формат ответа: {"patch":{"name":"...","description":"...","price":0,"category":"id","subcategory":"id"}}
- Не меняй external_id и photos.
- Если меняешь category/subcategory, используй только id из справочника ниже.
- Если значение не нужно менять, можешь не включать поле в patch.
- Если запрос затрагивает атрибуты, верни их внутри patch.attributes.
- Приоритетные атрибуты поставщика используй с указанными кодами; не выдумывай значение, если данных нет.
- name должен быть коротким: "Бренд + тип товара".
- description пиши на русском, без китайского текста и эмодзи.
- description должен быть содержательным: 2-3 предложения, примерно 160-320 символов.
- В description укажи модель/тип, цвет, материал или фактуру, фурнитуру/цепочку/ручки и сценарий носки, если это есть в исходнике или на фото.
- Если в исходном тексте есть размеры, сохрани их в описании.
- ${includePhotos ? 'Первое фото приложено к запросу, используй его для уточнения типа товара.' : 'Фото не приложено, опирайся только на текст и соседние строки.'}

Текущий товар:
${JSON.stringify(product, null, 2)}

Приоритетные атрибуты поставщика:
${JSON.stringify(supplierAttributeHints)}

Исходный товар из файла после скрипта${sourceContext.sourcePath ? ` (${path.basename(sourceContext.sourcePath)})` : ''}:
${JSON.stringify(source.sourceProduct || null, null, 2)}

Предыдущий исходный товар из файла после скрипта:
${JSON.stringify(source.previousSourceProduct || null, null, 2)}

Следующий исходный товар из файла после скрипта:
${JSON.stringify(source.nextSourceProduct || null, null, 2)}

Предыдущий товар в этой же выгрузке:
${JSON.stringify(item.previousProduct || null, null, 2)}

Следующий товар в этой же выгрузке:
${JSON.stringify(item.nextProduct || null, null, 2)}

Справочник брендов:
${JSON.stringify(brands)}

Справочник категорий:
${JSON.stringify(categories)}

Справочник подкатегорий:
${JSON.stringify(subcategories)}
`

      const content: any[] = [{ type: 'text', text: prompt }]
      if (firstPhoto) {
        content.push({
          type: 'image_url',
          image_url: { url: firstPhoto },
        })
      }

      try {
        console.log('[targetedAiEdit] openrouter request', {
          model,
          index: item.index,
          external_id: product.external_id || null,
          hasSource: Boolean(source.sourceProduct),
          hasFirstPhoto: Boolean(firstPhoto),
        })
        const result = await runOpenRouterJsonRequest(model, content)
        const patch = normalizePatch(result.patch || result, lookups)
        return {
          ok: true,
          patch: {
          index: item.index,
          external_id: product.external_id,
          patch,
          },
        }
      } catch (error: any) {
        console.error('[targetedAiEdit] item failed', {
          index: item.index,
          external_id: product.external_id || null,
          message: error.message,
        })
        return {
          ok: false,
          error: `${product.external_id || item.index}: ${error.message}`,
        }
      }
    }))

    for (const result of results) {
      if (result.ok && result.patch) patches.push(result.patch)
      if (!result.ok && result.error) errors.push(result.error)
    }

    console.log('[targetedAiEdit] done', {
      patches: patches.length,
      errors: errors.length,
    })

    return {
      success: errors.length === 0,
      data: { patches, errors, model },
      error: errors.length ? errors.join('\n') : undefined,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function processAiAction(supplierId: number, products: any[], filePath?: string) {
  await requireAdmin()

  const tmpDir = getWritableTmpDir()
  const tempIn = path.join(tmpDir, `ai_in_${Date.now()}.json`)
  
  try {
    // 1. Создаем бэкап, если передан путь к файлу
    if (filePath) {
      const cleanPath = resolveSafeRuntimePath(filePath);
      if (fs.existsSync(/*turbopackIgnore: true*/ cleanPath)) {
        const backupPath = cleanPath.replace('.csv', '_original.csv');
        // Создаем бэкап только если его еще нет (чтобы не перезатереть самый первый оригинал)
        if (!fs.existsSync(/*turbopackIgnore: true*/ backupPath)) {
          fs.copyFileSync(
            /*turbopackIgnore: true*/ cleanPath,
            /*turbopackIgnore: true*/ backupPath,
          );
          console.log(`[AI Process] Created backup: ${backupPath}`);
        }
      }
    }

    const productsJson = JSON.stringify(products)
    
    // Ensure temp dir exists
    if (!fs.existsSync(/*turbopackIgnore: true*/ tmpDir)) {
        fs.mkdirSync(/*turbopackIgnore: true*/ tmpDir, { recursive: true })
    }
    
    // Пишем в UTF-8
    fs.writeFileSync(/*turbopackIgnore: true*/ tempIn, productsJson, 'utf-8')
    
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'universal_ai_process.py')
    const pythonCmd = process.env.PYTHON_PATH || 'python'
    
    // Устанавливаем PYTHONIOENCODING=utf-8 для корректного вывода stdout
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    
    // Execute Python script passing the file path
    // Increase maxBuffer to 100MB (100 * 1024 * 1024) to handle large product sets
    const { stdout, stderr } = await execFileAsync(
      /*turbopackIgnore: true*/ pythonCmd,
      [
        /*turbopackIgnore: true*/ scriptPath,
        String(supplierId),
        /*turbopackIgnore: true*/ tempIn,
      ],
      {
        env,
        maxBuffer: 100 * 1024 * 1024,
      },
    )

    if (stderr && !stdout) {
      console.error('Python Error:', stderr)
      return { success: false, error: stderr }
    }

    try {
      const results = JSON.parse(stdout)
      return { success: true, data: results }
    } catch (e) {
      console.error('Failed to parse Python output:', stdout)
      return { success: false, error: 'Failed to parse AI output. Check logs.' }
    }
  } catch (error: any) {
    console.error('AI Processing Error:', error)
    return { success: false, error: error.message }
  } finally {
    // Clean up temp file
    if (fs.existsSync(/*turbopackIgnore: true*/ tempIn)) {
        try { fs.unlinkSync(/*turbopackIgnore: true*/ tempIn) } catch(e) {}
    }
  }
}
