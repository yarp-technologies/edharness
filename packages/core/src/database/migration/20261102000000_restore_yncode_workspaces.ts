import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { LegacyWorkspace } from "../legacy-workspace.js"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261102000000_restore_yncode_workspaces",
  up(tx) {
    return Effect.gen(function* () {
      const saved = yield* tx.get(sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_yncode_legacy_workspace'
      `)
      if (!saved) return
      const workspaces = yield* tx.all<LegacyWorkspace.Snapshot>(
        sql`SELECT id, type, name, branch, directory, extra, project_id, time_used FROM _yncode_legacy_workspace`,
      )
      const restored = new Map<string, { projectID: string; directory?: string }>()
      for (const workspace of workspaces) {
        const directory = LegacyWorkspace.localDirectory(workspace.type, workspace.directory)
        const provider = LegacyWorkspace.provider(workspace)
        const binding = LegacyWorkspace.binding(workspace)
        yield* tx.run(sql`
          INSERT OR IGNORE INTO workspace (id, provider, binding, created_at, last_used_at)
          VALUES (${workspace.id}, ${provider}, ${binding}, ${workspace.time_used}, ${workspace.time_used})
        `)
        const current = yield* tx.get<{ provider: string; binding: string | null }>(
          sql`SELECT provider, binding FROM workspace WHERE id = ${workspace.id}`,
        )
        // An existing newer workspace with the same ID remains authoritative.
        if (current?.provider !== provider || current.binding !== binding) {
          yield* Effect.logWarning("Could not restore legacy workspace because its ID is already in use", {
            workspaceID: workspace.id,
          })
          continue
        }
        restored.set(workspace.id, { projectID: workspace.project_id, directory })
        if (!directory) {
          yield* Effect.logWarning("Legacy workspace requires an unsupported adapter", {
            workspaceID: workspace.id,
            type: workspace.type,
          })
          continue
        }
        yield* tx.run(sql`
          INSERT OR IGNORE INTO worktree (project_id, directory, strategy, time_created)
          SELECT id, ${directory}, 'git', ${workspace.time_used} FROM project
          WHERE id = ${workspace.project_id} AND worktree <> ${directory}
        `)
      }

      const session = yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
      if (!session) return
      const savedLinks = yield* tx.get(sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_yncode_legacy_session_workspace'
      `)
      const links = yield* tx.all<{ id: string; project_id: string; directory: string; workspace_id: string | null }>(
        savedLinks
          ? sql`
              SELECT session.id, session.project_id, session.directory,
                     COALESCE(session.workspace_id, saved.workspace_id) AS workspace_id
              FROM session LEFT JOIN _yncode_legacy_session_workspace AS saved ON saved.session_id = session.id
            `
          : sql`SELECT id, project_id, directory, workspace_id FROM session`,
      )
      for (const link of links) {
        if (!link.workspace_id) continue
        const workspace = restored.get(link.workspace_id)
        if (!workspace || workspace.projectID !== link.project_id) continue
        yield* tx.run(sql`
          UPDATE session_v2
          SET workspace_id = ${link.workspace_id},
              directory = CASE WHEN directory = ${link.directory} THEN ${workspace.directory ?? link.directory} ELSE directory END,
              path = ${workspace.directory ? sql`CASE WHEN directory = ${link.directory} THEN '' ELSE path END` : sql`path`}
          WHERE id = ${link.id} AND project_id = ${link.project_id}
            AND (workspace_id = ${link.workspace_id} OR (workspace_id IS NULL AND directory = ${link.directory}))
        `)
      }
    })
  },
}

export default migration
