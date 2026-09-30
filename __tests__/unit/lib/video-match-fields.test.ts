import { describe, expect, it } from 'vitest'
import {
  compareFields,
  isCandidate,
  normalizeFields,
  normalizeHardware,
  parseAlbumFields,
  parseCatalogFields,
} from '@/lib/video-match-fields'
import { buildAlbumIndex, buildMatchRows, duplicateVideoUrls } from '@/lib/video-match-build'

const ALBUM_TEXT = 'Style：Bolide On Wheels Colour：Q0/vert mangrove Size：18*8*15cm Leather：Epsom From France Hardware：silver 保龄球车轮包，沼泽绿，法国进口原厂掌纹牛皮，银扣，高级全手工专属定制‼️ 客订实拍🐎🐎customer order🐎🐎 Bolide On Wheels保龄球车轮'

const CATALOG_TEXT = [
  'Стиль: Bolide On Wheels',
  'Цвет: Q0/Vert Mangrove',
  'Размер: 18 x 8 x 15 см',
  'Кожа: Epsom from France',
  'Фурнитура: серебряная',
  'Материалы: французская кожа',
  'Особенности: ручная работа',
].join('\n')

describe('video match fields', () => {
  it('разбирает характеристики альбома поставщика', () => {
    const fields = parseAlbumFields(ALBUM_TEXT)
    expect(fields.style).toBe('Bolide On Wheels')
    expect(fields.colour).toBe('Q0/vert mangrove')
    expect(fields.size).toBe('18*8*15cm')
    expect(fields.leather).toBe('Epsom From France')
    expect(normalizeHardware(fields.hardware)).toBe('silver')
  })

  it('разбирает блок характеристик каталога и не съедает следующие строки', () => {
    const fields = parseCatalogFields(CATALOG_TEXT)
    expect(fields.style).toBe('Bolide On Wheels')
    expect(fields.colour).toBe('Q0/Vert Mangrove')
    expect(fields.size).toBe('18 x 8 x 15 см')
    expect(fields.leather).toBe('Epsom from France')
    expect(fields.hardware).toBe('серебряная')
  })

  it('терпит опечатки и порядок ключей', () => {
    const fields = parseAlbumFields('Colour：89/Noir Style：Kelly Size：25*20*13cm Haedware：Gold Leather：Togo')
    expect(fields.style).toBe('Kelly')
    expect(fields.colour).toBe('89/Noir')
    expect(fields.hardware).toBe('Gold')
  })

  it('нормализует регистр, разделители размеров и фурнитуру', () => {
    const album = normalizeFields(parseAlbumFields(ALBUM_TEXT))
    const catalog = normalizeFields(parseCatalogFields(CATALOG_TEXT))
    expect(album.style).toBe(catalog.style)
    expect(album.colourCode).toBe(catalog.colourCode)
    expect(album.colourName).toBe(catalog.colourName)
    expect(album.size).toBe(catalog.size)
    expect(album.leather).toBe(catalog.leather)
    expect(album.hardware).toBe(catalog.hardware)
    expect(album.hardware).toBe('silver')
  })

  it('считает перестановку слов в модели той же моделью', () => {
    const left = normalizeFields({ style: 'Kelly Mini 2', colour: null, size: null, leather: null, hardware: null })
    const right = normalizeFields({ style: 'mini kelly 2', colour: null, size: null, leather: null, hardware: null })
    expect(left.styleSignature).toBe(right.styleSignature)
  })

  it('распознаёт фурнитуру по русским и английским словам', () => {
    expect(normalizeHardware('Серебряная фурнитура')).toBe('silver')
    expect(normalizeHardware('золотая')).toBe('gold')
    expect(normalizeHardware('Sliver')).toBe('silver')
    expect(normalizeHardware('розовое золото')).toBe('rose')
    expect(normalizeHardware('')).toBeNull()
  })

  it('даёт 100 баллов полному совпадению и понижает уровень при расхождении кожи', () => {
    const catalog = normalizeFields(parseCatalogFields(CATALOG_TEXT))
    const album = normalizeFields(parseAlbumFields(ALBUM_TEXT))
    const full = compareFields(catalog, album)
    expect(full.score).toBe(100)
    expect(full.confidence).toBe('exact')

    const otherLeather = normalizeFields(parseAlbumFields(ALBUM_TEXT.replace('Epsom', 'Togo')))
    const weaker = compareFields(catalog, otherLeather)
    expect(weaker.score).toBeLessThan(100)
    expect(weaker.differences.find((difference) => difference.field === 'leather')?.verdict).toBe('mismatch')
    expect(weaker.confidence).toBe('strong')
  })

  it('не считает кандидатом другой размер и другую модель', () => {
    const catalog = normalizeFields(parseCatalogFields(CATALOG_TEXT))
    const otherSize = normalizeFields(parseAlbumFields(ALBUM_TEXT.replace('18*8*15cm', '22*10*17cm')))
    expect(isCandidate(compareFields(catalog, otherSize))).toBe(false)

    const otherStyle = normalizeFields(parseAlbumFields(ALBUM_TEXT.replace('Bolide On Wheels', 'Lindy')))
    expect(isCandidate(compareFields(catalog, otherStyle))).toBe(false)
  })

  it('помечает отсутствующее поле как unknown, а не как расхождение', () => {
    const catalog = normalizeFields({ style: 'Kelly', colour: '89/Noir', size: '25x20x13', leather: null, hardware: null })
    const album = normalizeFields({ style: 'Kelly', colour: '89/Noir', size: '25x20x13', leather: 'Togo', hardware: 'silver' })
    const comparison = compareFields(catalog, album)
    expect(comparison.differences.find((difference) => difference.field === 'leather')?.verdict).toBe('unknown')
    expect(comparison.differences.find((difference) => difference.field === 'hardware')?.verdict).toBe('unknown')
  })
})

describe('video match build', () => {
  const albumRow = (id: number, position: number, description: string, video: string, photo: string) => ({
    id,
    external_id: `_ext_${id}`,
    source_position: position,
    description,
    photos: [photo],
    attributes: { szwego_video_url: video, szwego_tags: ['Bolide On Wheels'] },
  })

  it('индексирует только альбомы с видео и разобранным стилем', () => {
    const index = buildAlbumIndex([
      albumRow(1, 0, ALBUM_TEXT, 'https://video/a.mp4', 'https://img/a.jpg'),
      albumRow(2, 1, 'Сервисная карточка без характеристик', 'https://video/b.mp4', 'https://img/b.jpg'),
      { id: 3, external_id: '_ext_3', source_position: 2, description: ALBUM_TEXT, photos: [], attributes: {} },
    ])
    expect(index.albums).toHaveLength(1)
    expect(index.withoutFields).toBe(1)
    expect(index.withoutVideo).toBe(1)
    expect(index.albums[0].posterUrl).toBe('https://img/a.jpg')
  })

  it('схлопывает повторяющиеся видео и ранжирует варианты', () => {
    const albums = buildAlbumIndex([
      albumRow(1, 0, ALBUM_TEXT, 'https://video/same.mp4', 'https://img/a.jpg'),
      albumRow(2, 1, ALBUM_TEXT, 'https://video/same.mp4', 'https://img/a2.jpg'),
      albumRow(3, 2, ALBUM_TEXT, 'https://video/other.mp4', 'https://img/a3.jpg'),
    ]).albums
    const duplicated = duplicateVideoUrls(albums)
    expect(duplicated.has('https://video/same.mp4')).toBe(true)
    expect(duplicated.has('https://video/other.mp4')).toBe(false)

    const rows = buildMatchRows({
      albums,
      duplicateVideos: duplicated,
      products: [{
        id: '11111111-1111-1111-1111-111111111111',
        slug: 'bolide-on-wheels',
        name: 'Bolide On Wheels',
        category: 'Сумки на плечо',
        status: 'active',
        photoUrl: 'https://static/products/bolide.webp',
        description: CATALOG_TEXT,
      }],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].rank).toBe(1)
    expect(rows[0].candidatesTotal).toBe(2)
    expect(rows.every((row) => row.confidence === 'exact')).toBe(true)
    // Первым идёт самый свежий альбом, повторяющееся видео помечено флагом.
    expect(rows[0].videoSourceUrl).toBe('https://video/other.mp4')
    expect(rows[0].duplicatedVideo).toBe(false)
    expect(rows[1].duplicatedVideo).toBe(true)
    expect(rows[0].crmPhotoUrl).toBe('https://static/products/bolide.webp')
  })

  it('не создаёт пар для товара без разобранных характеристик', () => {
    const albums = buildAlbumIndex([albumRow(1, 0, ALBUM_TEXT, 'https://video/a.mp4', 'https://img/a.jpg')]).albums
    const rows = buildMatchRows({
      albums,
      products: [{
        id: '22222222-2222-2222-2222-222222222222',
        slug: 'unknown',
        name: 'Unknown',
        category: 'Сумки на плечо',
        status: 'active',
        photoUrl: null,
        description: 'Описание без блока характеристик',
      }],
    })
    expect(rows).toHaveLength(0)
  })
})
