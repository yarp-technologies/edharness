import { Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260812181746_session_inbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_inbox\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`payload\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`enqueued_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_inbox_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_inbox_session_delivery_seq_idx\` ON \`session_inbox\` (\`session_id\`,\`delivery\`,\`enqueued_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_inbox_session_enqueued_seq_idx\` ON \`session_inbox\` (\`session_id\`,\`enqueued_seq\`);`,
      )
      if (yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_yncode_legacy_inbox'`)) {
        const rows = yield* tx.all<{
          id: string
          session_id: string
          prompt: string
          delivery: string
          admitted_seq: number
          time_created: number
        }>(sql`SELECT id, session_id, prompt, delivery, admitted_seq, time_created FROM _yncode_legacy_inbox`)
        for (const row of rows) {
          const payload = Schema.decodeUnknownSync(SessionInbox.UserPayload)(
            SessionLegacy.prompt(JSON.parse(row.prompt)),
          )
          yield* tx.run(sql`
            INSERT INTO session_inbox (id, session_id, type, payload, delivery, enqueued_seq, time_created)
            VALUES (${row.id}, ${row.session_id}, 'user', ${JSON.stringify(payload)}, ${row.delivery}, ${row.admitted_seq}, ${row.time_created})
          `)
        }
        yield* tx.run(`DROP TABLE _yncode_legacy_inbox`)
      }
    })
  },
}

export default migration
