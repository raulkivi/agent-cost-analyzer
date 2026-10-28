CREATE TABLE turns (
				id TEXT PRIMARY KEY NOT NULL
			, event_id TEXT, checkpoint_ref TEXT);

CREATE TABLE session_metadata (
			key   TEXT PRIMARY KEY NOT NULL,
			value TEXT NOT NULL
		);

CREATE TABLE "file_edits" (
				turn_id        TEXT    NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
				tool_call_id   TEXT    NOT NULL,
				file_path      TEXT    NOT NULL,
				edit_type      TEXT    NOT NULL DEFAULT 'edit',
				original_path  TEXT,
				before_content BLOB,
				after_content  BLOB,
				added_lines    INTEGER,
				removed_lines  INTEGER,
				PRIMARY KEY (tool_call_id, file_path)
			);

CREATE TABLE chat_drafts (
			chat_uri TEXT PRIMARY KEY NOT NULL,
			draft    TEXT NOT NULL
		);

CREATE TABLE reviewed_files (
			uri   TEXT NOT NULL,
			nonce TEXT NOT NULL,
			PRIMARY KEY (uri, nonce)
		);

CREATE TABLE local_turns (
			turn_id        TEXT PRIMARY KEY NOT NULL,
			chat_uri       TEXT NOT NULL,
			anchor_turn_id TEXT,
			seq            INTEGER NOT NULL,
			payload        TEXT NOT NULL
		, kind TEXT NOT NULL DEFAULT 'local');

CREATE TABLE turn_usage (
			turn_id TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			usage   TEXT NOT NULL
		);

CREATE TABLE turn_delegation (
			turn_id    TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			delegation TEXT NOT NULL
		);

CREATE TABLE turn_workspace_transition (
			turn_id    TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			transition TEXT NOT NULL
		);

CREATE TABLE catalog_sync_snapshot (
			singleton_id       INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
			session_generation TEXT NOT NULL CHECK (length(session_generation) > 0),
			source_revision    INTEGER NOT NULL CHECK (source_revision >= 0),
			projection_version INTEGER NOT NULL CHECK (projection_version >= 0),
			acknowledged_hash  TEXT,
			pending_hash       TEXT,
			pending_payload    TEXT,
			CHECK (acknowledged_hash IS NULL OR length(acknowledged_hash) > 0),
			CHECK (
				(pending_hash IS NULL AND pending_payload IS NULL)
				OR (length(pending_hash) > 0 AND pending_payload IS NOT NULL)
			),
			CHECK (acknowledged_hash IS NOT NULL OR pending_hash IS NOT NULL)
		);

CREATE TABLE terminal_outputs (
			tool_call_id TEXT PRIMARY KEY NOT NULL,
			turn_id      TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			output       BLOB NOT NULL
		);

CREATE TABLE tool_result_resources (
			tool_call_id TEXT    NOT NULL,
			ordinal      INTEGER NOT NULL,
			turn_id      TEXT    NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			kind         TEXT    NOT NULL,
			name         TEXT    NOT NULL,
			mime_type    TEXT,
			uri          TEXT    NOT NULL,
			size         INTEGER,
			content      BLOB,
			PRIMARY KEY (tool_call_id, ordinal)
		);
