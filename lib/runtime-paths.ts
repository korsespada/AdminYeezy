import os from 'os'
import path from 'path'

function workspaceRoot() {
  return process.cwd()
}

export function runtimeWritableDirs() {
  const root = workspaceRoot()
  const dirs = [
    path.join(root, 'tmp'),
    path.join(root, 'scratch'),
  ]

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    dirs.push(os.tmpdir())
  }

  return Array.from(new Set(dirs.map((dir) => path.resolve(dir))))
}

export function resolveSafeRuntimePath(filePath: string) {
  const cleanPath = filePath.replace(/"/g, '').trim()
  if (!cleanPath) throw new Error('File path is required')

  const resolved = path.resolve(cleanPath)
  const allowedDirs = runtimeWritableDirs()
  const allowed = allowedDirs.some((dir) => (
    resolved === dir || resolved.startsWith(`${dir}${path.sep}`)
  ))

  if (!allowed) {
    throw new Error('File path is outside the allowed runtime directories')
  }

  return resolved
}

export function isSafeRuntimePath(filePath: string | null | undefined) {
  if (!filePath) return false
  try {
    resolveSafeRuntimePath(filePath)
    return true
  } catch {
    return false
  }
}
