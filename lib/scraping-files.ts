import fs from 'fs/promises'
import path from 'path'
import { scrapingQuery } from './db'

type SaveScrapingFileParams = {
  taskId: number
  supplierId?: number | null
  batchId?: string | null
  status?: string | null
  filePath: string
  content?: string
}

function cleanFilePath(filePath: string) {
  return filePath.replace(/"/g, '')
}

function decodeCsvBuffer(buffer: Buffer) {
  const encodings = ['utf-8', 'gbk', 'windows-1251']

  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer)
    } catch {}
  }

  return new TextDecoder('utf-8').decode(buffer)
}

export async function saveScrapingFileArtifact({
  taskId,
  supplierId = null,
  batchId = null,
  status = null,
  filePath,
  content,
}: SaveScrapingFileParams) {
  const normalizedPath = cleanFilePath(filePath)
  const fileName = path.basename(normalizedPath)
  const csvContent = content ?? decodeCsvBuffer(await fs.readFile(normalizedPath))
  const sizeBytes = Buffer.byteLength(csvContent, 'utf8')

  await scrapingQuery(`
    INSERT INTO scraping_files (
      task_id,
      batch_id,
      supplier_id,
      status,
      file_name,
      result_path,
      mime_type,
      size_bytes,
      content,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
    ON CONFLICT (task_id) DO UPDATE SET
      batch_id = EXCLUDED.batch_id,
      supplier_id = EXCLUDED.supplier_id,
      status = EXCLUDED.status,
      file_name = EXCLUDED.file_name,
      result_path = EXCLUDED.result_path,
      mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes,
      content = EXCLUDED.content,
      updated_at = NOW()
  `, [
    taskId,
    batchId,
    supplierId,
    status,
    fileName,
    normalizedPath,
    'text/csv',
    sizeBytes,
    csvContent,
  ])

  return { fileName, content: csvContent, sizeBytes }
}

export async function getScrapingFileArtifact(filePath: string, taskId?: number | null) {
  const normalizedPath = cleanFilePath(filePath)
  const fileName = path.basename(normalizedPath)

  const res = await scrapingQuery(`
    SELECT task_id, batch_id, supplier_id, status, file_name, result_path, content
    FROM scraping_files
    WHERE ($1::int IS NOT NULL AND task_id = $1)
       OR result_path = $2
       OR file_name = $3
    ORDER BY
      CASE
        WHEN $1::int IS NOT NULL AND task_id = $1 THEN 0
        WHEN result_path = $2 THEN 1
        ELSE 2
      END,
      updated_at DESC
    LIMIT 1
  `, [taskId || null, normalizedPath, fileName])

  return res.rows[0] || null
}

export async function deleteScrapingFileArtifactForTask(taskId: number) {
  await scrapingQuery('DELETE FROM scraping_files WHERE task_id = $1', [taskId])
}

export async function deleteScrapingFileArtifactsForBatch(batchId: string) {
  await scrapingQuery('DELETE FROM scraping_files WHERE batch_id = $1', [batchId])
}
