import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const workspacePython = process.platform === 'win32'
  ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
  : path.join(process.cwd(), '.venv', 'bin', 'python')
const python = process.env.PYTHON_PATH || (fs.existsSync(workspacePython) ? workspacePython : 'python')

// Runs SzwegoParser.evaluate_item on one feed item without network access.
const harness = `
import importlib.util, json, sys, argparse
spec = importlib.util.spec_from_file_location("sz", "scripts/parser/SzwegoParser.py")
sz = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sz)
item = json.loads(sys.stdin.buffer.read().decode("utf-8"))
args = argparse.Namespace(parse_mode="all", parse_tags=False, min_desc=0, min_photos=9, default_price=0,
                          brand="", category="", subcategory="", gender="")
row, reason, _ = sz.evaluate_item(item, args, None, None, "album")
sys.stdout.buffer.write(json.dumps({"description": row[2], "photos": json.loads(row[8]), "attributes": row[9]} if row else {"reason": reason}, ensure_ascii=False).encode("utf-8"))
`

function evaluate(item: unknown) {
  const result = spawnSync(python, ['-c', harness], { input: JSON.stringify(item), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

const image = (url: string) => ({ url, type: 'IMAGE', thumbnail: `${url}?imageMogr2/thumbnail/!310x310r`, cover: '' })

describe('SzwegoParser sourceList', () => {
  it('collects every block of the post card, not only the feed gallery', () => {
    const result = evaluate({
      goods_id: 'lv-jacket',
      title: 'LV jacket\nmain description',
      time_stamp: 1793084134355,
      imgsSrc: ['https://x.szwego.com/imgHD/a/i1_0.jpg', 'https://x.szwego.com/imgHD/a/cmp_i2_1.jpg'],
      sourceList: [
        { title: 'LV jacket\nmain description', medias: [image('https://x.szwego.com/imgHD/a/cmp_i1_0.jpg'), image('https://x.szwego.com/imgHD/a/cmp_i2_1.jpg')] },
        { title: 'video', medias: [{ url: 'https://x.szwego.com/pvodHD/a/cmp_o1.mp4', type: 'VIDEO', thumbnail: 'https://x.szwego.com/img/a/cover.jpg', cover: 'https://x.szwego.com/img/a/cover.jpg' }] },
        { title: 'details', medias: [image('https://x.szwego.com/imgHD/a/cmp_i3_0.jpg'), image('https://x.szwego.com/imgHD/a/cmp_i4_1.jpg')] },
        { title: 'LV jacket【尺码表】', medias: [image('https://x.szwego.com/imgHD/a/cmp_a5.jpg')] },
      ],
    })

    expect(result.photos).toEqual([
      'https://x.szwego.com/imgHD/a/i1_0.jpg',
      'https://x.szwego.com/imgHD/a/cmp_i2_1.jpg',
      'https://x.szwego.com/imgHD/a/cmp_i3_0.jpg',
      'https://x.szwego.com/imgHD/a/cmp_i4_1.jpg',
      'https://x.szwego.com/imgHD/a/cmp_a5.jpg',
    ])
    expect(result.description).toBe('LV jacket\nmain description\nvideo\ndetails\nLV jacket【尺码表】')
    expect(result.attributes.szwego_video_url).toBe('https://x.szwego.com/pvodHD/a/cmp_o1.mp4')
    expect(result.attributes.szwego_video_poster_url).toBe('https://x.szwego.com/img/a/cover.jpg')
  })

  it('does not take an image thumbnail as a video poster', () => {
    const result = evaluate({
      goods_id: 'photos-only',
      title: 'photos only',
      time_stamp: 1793084134355,
      imgsSrc: Array.from({ length: 9 }, (_, index) => `https://x.szwego.com/img/a/i${index}.jpg`),
      sourceList: [{ title: 'photos only', medias: [image('https://x.szwego.com/img/a/cmp_i0.jpg')] }],
    })

    expect(result.photos).toHaveLength(9)
    expect(result.attributes.szwego_video_url).toBeUndefined()
    expect(result.attributes.szwego_video_poster_url).toBeUndefined()
  })

  it('saves the sale price of the attached product card', () => {
    const base = { title: 'card', time_stamp: 1793084134355, imgsSrc: Array.from({ length: 9 }, (_, index) => `https://x.szwego.com/img/a/p${index}.jpg`) }
    const priced = evaluate({ ...base, goods_id: 'priced', optimaPrice: '1680', priceArr: [{ priceType: 2, value: 1680 }] })
    expect(priced.attributes.szwego_price).toBe(1680)

    const fallback = evaluate({ ...base, goods_id: 'fallback', optimaPrice: '2100.5', priceArr: [] })
    expect(fallback.attributes.szwego_price).toBe(2100.5)

    const unpriced = evaluate({ ...base, goods_id: 'unpriced', optimaPrice: '', priceArr: [] })
    expect(unpriced.attributes.szwego_price).toBeUndefined()
  })
})
