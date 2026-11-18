/** Temporary directories for the multi-user configuration specs. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []

/**
 * Create one temporary directory for the calling spec.
 * @returns the absolute path of the new directory.
 */
export function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-multi-user-'))
  roots.push(root)
  return root
}

/** Remove every temporary directory created since the previous call. */
export function removeTemporaryRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}
