import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const workspacePython = process.platform === 'win32'
  ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
  : path.join(process.cwd(), '.venv', 'bin', 'python')
const python = process.env.PYTHON_PATH || (fs.existsSync(workspacePython) ? workspacePython : 'python')

// Normalizes a stored tag/group selection and matches it against one feed item.
const harness = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sz", "scripts/parser/SzwegoParser.py")
sz = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sz)
payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
ids = sz._split_szwego_filter_ids(payload["raw"])
matched = bool(ids) and sz._item_has_any_szwego_tag_id(payload["item"], ids)
sys.stdout.buffer.write(json.dumps({"ids": ids, "matched": matched}, ensure_ascii=False).encode("utf-8"))
`

function normalize(raw: string, item: unknown = {}) {
  const result = spawnSync(python, ['-c', harness], { input: JSON.stringify({ raw, item }), encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout) as { ids: string[]; matched: boolean }
}

describe('SzwegoParser tag/group filter ids', () => {
  it('keeps only the id of a legacy label=id selection', () => {
    expect(normalize('balenciaga=18942846').ids).toEqual(['18942846'])
  })

  it('reads every line of a multi-select', () => {
    expect(normalize('balenciaga=715404\ngucci=716433\nmiu miu=54762430').ids).toEqual(['715404', '716433', '54762430'])
  })

  it('passes a bare id through unchanged', () => {
    expect(normalize('18942846').ids).toEqual(['18942846'])
  })

  it('matches a publication by the normalized id instead of the label', () => {
    const item = { goods_id: 'g1', tags: [{ tagId: 18942846, tagName: '巴黎世家' }] }
    expect(normalize('balenciaga=18942846', item).matched).toBe(true)
    expect(normalize('gucci=715404', item).matched).toBe(false)
  })

  it('ignores an empty selection', () => {
    expect(normalize('').ids).toEqual([])
  })
})
