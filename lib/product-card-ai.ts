import {
  buildBatchAiContactSheets,
  GLOBAL_BATCH_AI_CATALOG_RULES,
  runBatchAiOpenRouter,
  type AiCompletionSettings,
} from '@/lib/batch-ai'
import { normalizePhotoAlts } from '@/lib/product-media-seo'
import { parseHermesCardFacts } from '@/lib/hermes-card-facts'
import { composeCardSystemPrompt } from '@/lib/product-card-prompts'
import type { CardUpdateRecord } from '@/lib/product-card-updates'

/**
 * ИИ-проход по уже опубликованной карточке поставщика: полное описание по
 * правилам выгрузки и альты на каждое фото товара.
 *
 * Фотографии берутся из карточки Rails (contact sheet 3×3, как в «Выгрузках»),
 * факты — из текущего описания и предложения детерминированного слоя.
 * Один запрос на товар: второй проход для альтов не нужен.
 */

export const PRODUCT_CARD_AI_SYSTEM_PROMPT = `Ты — редактор каталога премиальных товаров. Ты дописываешь уже опубликованную карточку поставщика Hermes: публичное описание и альты фотографий.

Требования:
- Пиши по-русски, без китайских иероглифов, эмодзи и рекламных обещаний. Слова «оригинал», «официальный», «люкс», «премиальный», «высшего класса», «1:1», «заказ клиента», «Франция», цены, сроки отправки и условия возврата не переноси.
- description: связный публичный текст о товаре. Целевая длина 900–1800 знаков. Это баланс двух источников: подтверждённые факты исходного текста (материал, фурнитура, конструкция, габариты, размерный ряд) плюс всё, что различимо на фотографиях (силуэт и форма, ручки и ремень, клапан и замок, швы, фактура кожи, дно и ножки, подкладка, фурнитура). Если исходный текст богатый — сохрани все его технические факты и дополни видимыми деталями; если скудный — опирайся на фотографии. Не сокращай текст до общих фраз и не выдумывай то, чего нет ни в тексте, ни на фото.
- Опиши не меньше шести различимых признаков, когда они видны. Каждый подтверждённый материал перенеси и в текст, и в отдельное поле materials.
- Обязательно назови в описании тип изделия, модель, цвет Hermes (код и имя, например 18/Etoupe, 89/Noir), материал и фурнитуру, если они подтверждены. Если в исходнике цвет назван по-русски вместе с внутренним цветом Hermes («Черный (ck89/Noir)»), укажи оба: «чёрный (ck89/Noir)». Для сумок укажи габариты в формате «26 × 18 × 12 см», для обуви — доступный размерный ряд.
- Про упаковку, коробку, пыльник и бутиковый сет не пиши вообще: этот абзац добавляется к описанию отдельно и централизованно.
- Материал подошвы упоминай только когда он подтверждён текстом. Кожаная поверхность снизу — это стелька, а не подошва: кожаной подошвы не бывает.
- Разделяй смысловые части одним переносом строки, без заголовков, без маркированных списков и без фраз «на фото видно», «в карточке указано».
- photo_alts: ровно один alt на каждую исходную фотографию, в том же порядке, что и номера на contact sheet. Целевая длина 60–120 символов, жёсткий максимум 160. Бренд Hermes обязателен в каждом альте, дальше товар, ракурс и 1–2 различимые детали. Не упоминай коробку, упаковку, пакет, подложку, фон и соседние предметы: описывай только сам товар.
- materials: массив подтверждённых материалов на русском, короткими значениями («Кожа Togo», «Замша», «Холст H canvas»). Пустой массив, если материал не подтверждён.
- Не добавляй свойства, которых нет в исходных данных и на фотографиях. Если деталь не подтверждена — не упоминай её.
- Верни строго JSON без markdown: {"description": "…", "photo_alts": ["…"], "materials": ["…"]}.`

/** Пользовательский промпт: факты карточки и нумерация листов фотографий. */
export function buildProductCardAiPrompt(row: CardUpdateRecord) {
  const facts = parseHermesCardFacts(row.current_description)
  const sheets = Math.ceil((row.current_media || []).length / 9)
  const lines = [
    `Категория: ${row.category || 'без категории'} (${row.kind === 'bag' ? 'сумка' : 'обувь'}).`,
    `Текущее название: ${row.current_name || '—'}.`,
    `Предлагаемое название: ${row.proposed_name || '—'}.`,
    `Модель: ${row.model_name || facts.style || '—'}.`,
    `Цвет Hermes: ${facts.colourDisplay || '—'}${facts.colourGloss ? ` (по-русски: ${facts.colourGloss})` : ''}.`,
    `Материал: ${facts.material || '—'}.`,
    `Фурнитура: ${facts.hardwareRaw || '—'}.`,
    `Размер из описания: ${facts.sizeRaw || '—'}.`,
    `Текущее описание карточки:`,
    String(row.current_description || '').slice(0, 4000) || '—',
    '',
    `Фотографий у товара: ${(row.current_media || []).length}; contact sheet: ${sheets} по 9 кадров с номерами.`,
    'Верни описание и photo_alts ровно на это количество фотографий.',
  ]
  return lines.join('\n')
}

/** Нормализует ответ модели: описание, альты и подтверждённые материалы. */
export function normalizeProductCardAiOutput(raw: unknown, photoCount: number, fallbackName: string) {
  const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const description = String(payload.description || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const alts = normalizePhotoAlts(payload.photo_alts, photoCount, fallbackName)
  const materials = (Array.isArray(payload.materials) ? payload.materials : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3)
  return { description, photoAlts: alts, materials }
}

/**
 * Один запрос модели по товару: contact sheet фотографий из Rails.
 * Блок комплектации добавляется к описанию отдельным абзацем — его текст
 * хранится у поставщика и не зависит от ответа модели.
 */
export async function runProductCardAi(
  row: CardUpdateRecord,
  settings: AiCompletionSettings,
  supplierPrompt?: string | null,
  packaging?: string | null,
) {
  const photoUrls = (row.current_media || [])
    .map((item) => String(item.original_url || item.preview_url || ''))
    .filter(Boolean)
  if (photoUrls.length === 0) throw new Error('у товара нет фотографий для ИИ')

  const contactSheets = await buildBatchAiContactSheets(photoUrls, {
    additionalHosts: ['static.yeezyunique.ru'],
  })
  const raw = await runBatchAiOpenRouter({
    settings,
    systemPrompt: composeCardSystemPrompt({
      base: PRODUCT_CARD_AI_SYSTEM_PROMPT,
      supplierPrompt,
      catalogRules: GLOBAL_BATCH_AI_CATALOG_RULES,
    }),
    userPrompt: buildProductCardAiPrompt(row),
    contactSheets,
  })
  const normalized = normalizeProductCardAiOutput(
    raw,
    photoUrls.length,
    row.proposed_name || row.current_name || 'Hermes',
  )
  if (!normalized.description) throw new Error('ИИ не вернул описание')

  const packagingText = String(packaging || '').trim()
  return {
    ...normalized,
    description: packagingText ? `${normalized.description}\n\n${packagingText}` : normalized.description,
  }
}
