export * as LegacyWorkspace from "./legacy-workspace.js"

import { Effect } from "effect"
import { storedAbsolutePath } from "./path.js"
import type { DatabaseMigration } from "./migration.js"

type Transaction = Parameters<DatabaseMigration.Migration["up"]>[0]

export type Snapshot = {
  id: string
  type: string
  name: string
  branch: string | null
  directory: string | null
  extra: string | null
  project_id: string
  time_used: number
}

export const worktreeProvider = "yncode-legacy-worktree"

export function localDirectory(type: string, directory: string | null) {
  if (type !== "worktree" || !directory) return
  const windows = /^[A-Za-z]:\\/.test(directory) || directory.startsWith("\\\\")
  return storedAbsolutePath(windows ? directory.replaceAll("\\", "/") : directory)
}

export function provider(workspace: Snapshot) {
  return localDirectory(workspace.type, workspace.directory)
    ? worktreeProvider
    : `yncode-legacy-unsupported:${workspace.type}`
}

export function binding(workspace: Snapshot) {
  return JSON.stringify({
    type: workspace.type,
    name: workspace.name,
    branch: workspace.branch,
    directory: workspace.directory,
    extraJSON: workspace.extra,
    projectID: workspace.project_id,
  })
}

export const preserve = (tx: Transaction) =>
  Effect.gen(function* () {
    yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_legacy_workspace AS SELECT * FROM workspace`)
    yield* tx.run(`
      INSERT INTO _yncode_legacy_workspace
      SELECT * FROM workspace AS current
      WHERE NOT EXISTS (SELECT 1 FROM _yncode_legacy_workspace AS saved WHERE saved.id = current.id)
    `)
    yield* tx.run(`
      CREATE TABLE IF NOT EXISTS _yncode_legacy_session_workspace (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL
      )
    `)
    yield* tx.run(`
      INSERT OR IGNORE INTO _yncode_legacy_session_workspace (session_id, workspace_id)
      SELECT id, workspace_id FROM session WHERE workspace_id IS NOT NULL
    `)
  })
