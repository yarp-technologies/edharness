import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration.js"
import { LegacyWorkspace } from "../legacy-workspace.js"

const previousV2Marker = "20260730195856_optional_session_title"
const yncodeV2Marker = "20260622202450_simplify_session_input"

const migration: DatabaseMigration.Migration = {
  id: "20260804233008_loose_psylocke",
  up(tx) {
    return Effect.gen(function* () {
      // This marker identifies the completed pre-split V2 lineage. Its V2 tables
      // are canonical, so rename them in place instead of replaying the V1 squash.
      if (yield* tx.get(sql`SELECT id FROM migration WHERE id = ${previousV2Marker}`)) {
        const v1Only = yield* tx.get(sql`
          SELECT 1
          FROM message
          WHERE NOT EXISTS (
            SELECT 1 FROM session_message WHERE session_message.session_id = message.session_id
          )
          LIMIT 1
        `)
        if (v1Only) return yield* Effect.die(new Error("Previous V2 database contains V1-only session history"))

        yield* tx.run(`DROP INDEX IF EXISTS \`session_project_idx\`;`)
        yield* tx.run(`DROP INDEX IF EXISTS \`session_workspace_idx\`;`)
        yield* tx.run(`DROP INDEX IF EXISTS \`session_parent_idx\`;`)
        yield* tx.run(`DROP INDEX IF EXISTS \`session_time_suspended_idx\`;`)
        yield* tx.run(`ALTER TABLE \`session\` RENAME TO \`session_v2\`;`)
        yield* tx.run(`CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);`)
        yield* tx.run(`CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);`)
        yield* tx.run(`CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);`)
        yield* tx.run(
          `CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;`,
        )
        yield* tx.run(`DROP TABLE IF EXISTS \`data_migration\`;`)
        yield* tx.run(`DROP TABLE IF EXISTS \`session_context_epoch\`;`)
        yield* tx.run(`DROP TABLE IF EXISTS \`session_input\`;`)
        return
      }

      // The YarpNeuro fork shipped an earlier V2 schema. Its session_message rows are already canonical;
      // treating it as a V1-only database would drop those rows before the V1 importer can see them.
      const yncodeV2 = yield* tx.get(sql`SELECT id FROM migration WHERE id = ${yncodeV2Marker}`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`kv\` (
          \`key\` text PRIMARY KEY,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`instruction_blob\` (
          \`hash\` text PRIMARY KEY,
          \`value\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`instruction_entry\` (
          \`session_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`removed\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`instruction_entry_pk\` PRIMARY KEY(\`session_id\`, \`key\`),
          CONSTRAINT \`fk_instruction_entry_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`instruction_state\` (
          \`session_id\` text PRIMARY KEY,
          \`epoch_start\` integer NOT NULL,
          \`through_seq\` integer NOT NULL,
          \`initial_values\` text NOT NULL,
          \`current_values\` text NOT NULL,
          CONSTRAINT \`fk_instruction_state_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_pending\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          \`delivery\` text,
          \`admitted_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_pending_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_v2\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`fork_session_id\` text,
          \`fork_boundary\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      if (yncodeV2) {
        // Leave V1-only sessions to the V1 importer. Keep the original session table as a recovery source.
        yield* tx.run(`
          INSERT INTO session_v2 (
            id, project_id, parent_id, slug, directory, path, title, version, share_url,
            summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
            tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
            revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
          )
          SELECT id, project_id, parent_id, slug, directory, path, title, version, share_url,
            summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost,
            tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
            revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
          FROM session AS old
          WHERE EXISTS (SELECT 1 FROM session_message AS v2 WHERE v2.session_id = old.id)
             OR NOT EXISTS (SELECT 1 FROM message AS v1 WHERE v1.session_id = old.id)
        `)
        yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_preserved_v2 AS SELECT id FROM session_v2`)
        // Preserve workspace data before the upstream schema replaces the old workspace model.
        yield* LegacyWorkspace.preserve(tx)
        yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_legacy_input AS SELECT * FROM session_input`)
        yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_legacy_context AS SELECT * FROM session_context_epoch`)
        // The upstream V1 importer clears old event rows before replaying history.
        yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_legacy_event AS SELECT * FROM event`)
        yield* tx.run(`CREATE TABLE IF NOT EXISTS _yncode_legacy_event_sequence AS SELECT * FROM event_sequence`)
        yield* tx.run(`
          CREATE TABLE IF NOT EXISTS _yncode_legacy_inbox AS
          SELECT input.* FROM session_input AS input
          JOIN session_v2 AS session ON session.id = input.session_id
          WHERE input.promoted_seq IS NULL
        `)
      }
      yield* tx.run(`ALTER TABLE \`event\` ADD \`created\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`__new_session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      if (yncodeV2)
        yield* tx.run(`
          INSERT INTO __new_session_message (id, session_id, type, seq, time_created, time_updated, data)
          SELECT old.id, old.session_id, old.type, old.seq, old.time_created, old.time_updated, old.data
          FROM session_message AS old JOIN session_v2 AS session ON session.id = old.session_id
        `)
      yield* tx.run(`DROP TABLE \`session_message\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session_message\` RENAME TO \`session_message\`;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_pending_session_delivery_seq_idx\` ON \`session_pending\` (\`session_id\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_pending_session_compaction_idx\` ON \`session_pending\` (\`session_id\`) WHERE "session_pending"."type" = 'compaction';`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_pending_session_admitted_seq_idx\` ON \`session_pending\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;`,
      )
      yield* tx.run(`DROP TABLE \`data_migration\`;`)
      yield* tx.run(`DROP TABLE \`session_context_epoch\`;`)
      yield* tx.run(`DROP TABLE \`session_input\`;`)
    })
  },
}

export default migration
