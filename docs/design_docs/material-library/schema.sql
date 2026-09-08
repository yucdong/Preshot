-- Review-only schema. Never run this against an existing Preshot database.
-- Requires SQLite JSON functions and FTS5. Paths and UUIDs are validated natively.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;

CREATE TABLE library_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

INSERT INTO library_meta VALUES
    ('schema_version', '1'),
    ('index_generation', 'pending'),
    ('index_state', 'rebuild_required');

CREATE TABLE materials (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
    kind TEXT NOT NULL CHECK (kind IN (
        'imageGroup', 'shootingLocation', 'modelCard', 'prop', 'clothing'
    )),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    normalized_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
    metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    deleted_at INTEGER CHECK (deleted_at >= created_at),
    FOREIGN KEY (id, current_revision)
        REFERENCES material_revisions(material_id, revision)
        DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE material_revisions (
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    payload_version INTEGER NOT NULL CHECK (payload_version = 1),
    payload_json TEXT NOT NULL CHECK (
        length(CAST(payload_json AS BLOB)) <= 1048576 AND json_valid(payload_json)
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (material_id, revision)
) STRICT;

CREATE TABLE blobs (
    sha256 TEXT PRIMARY KEY NOT NULL CHECK (
        length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
    byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 33554432),
    pixel_width INTEGER NOT NULL CHECK (pixel_width BETWEEN 1 AND 8192),
    pixel_height INTEGER NOT NULL CHECK (pixel_height BETWEEN 1 AND 8192),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (pixel_width * pixel_height <= 32000000)
) STRICT;

-- Payload owns ordering, collection membership and visual geometry. This table
-- owns the byte mapping. Native/domain validation enforces the exact bijection.
CREATE TABLE revision_images (
    material_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    local_image_id TEXT NOT NULL CHECK (length(local_image_id) BETWEEN 1 AND 80),
    blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
    PRIMARY KEY (material_id, revision, local_image_id),
    FOREIGN KEY (material_id, revision)
        REFERENCES material_revisions(material_id, revision) ON DELETE CASCADE
) STRICT;
CREATE INDEX revision_images_blob ON revision_images(blob_sha256);

CREATE TABLE material_tags (
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    normalized_tag TEXT NOT NULL CHECK (length(normalized_tag) > 0),
    display_tag TEXT NOT NULL CHECK (length(trim(display_tag)) BETWEEN 1 AND 24),
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 11),
    PRIMARY KEY (material_id, normalized_tag),
    UNIQUE (material_id, position)
) STRICT;

CREATE TABLE material_previews (
    material_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    render_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
    relative_path TEXT,
    pixel_width INTEGER,
    pixel_height INTEGER,
    byte_length INTEGER,
    is_partial INTEGER NOT NULL DEFAULT 0 CHECK (is_partial IN (0, 1)),
    error_code TEXT,
    last_accessed_at INTEGER NOT NULL,
    PRIMARY KEY (material_id, revision, render_key),
    FOREIGN KEY (material_id, revision)
        REFERENCES material_revisions(material_id, revision) ON DELETE CASCADE,
    CHECK (
        (state = 'ready' AND relative_path IS NOT NULL
         AND pixel_width IS NOT NULL AND pixel_width BETWEEN 1 AND 480
         AND pixel_height IS NOT NULL AND pixel_height BETWEEN 1 AND 8192
         AND byte_length IS NOT NULL AND byte_length BETWEEN 1 AND 2097152
         AND error_code IS NULL)
        OR
        (state = 'pending' AND relative_path IS NULL
         AND pixel_width IS NULL AND pixel_height IS NULL AND byte_length IS NULL
         AND error_code IS NULL)
        OR
        (state = 'failed' AND relative_path IS NULL
         AND pixel_width IS NULL AND pixel_height IS NULL AND byte_length IS NULL
         AND error_code IS NOT NULL)
    )
) STRICT;

CREATE TABLE material_search (
    rowid INTEGER PRIMARY KEY REFERENCES materials(rowid) ON DELETE CASCADE,
    content_revision INTEGER NOT NULL,
    metadata_version INTEGER NOT NULL,
    index_generation TEXT NOT NULL,
    name_raw TEXT NOT NULL,
    tags_raw TEXT NOT NULL,
    body_raw TEXT NOT NULL,
    name_tokens TEXT NOT NULL,
    tags_tokens TEXT NOT NULL,
    body_tokens TEXT NOT NULL
) STRICT;

-- unicode61 is indexing pre-segmented token streams, NOT segmenting Chinese.
CREATE VIRTUAL TABLE material_fts USING fts5(
    name_tokens,
    tags_tokens,
    body_tokens,
    content = 'material_search',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 0'
);

CREATE TRIGGER material_search_ai AFTER INSERT ON material_search BEGIN
    INSERT INTO material_fts(rowid, name_tokens, tags_tokens, body_tokens)
    VALUES (new.rowid, new.name_tokens, new.tags_tokens, new.body_tokens);
END;
CREATE TRIGGER material_search_ad AFTER DELETE ON material_search BEGIN
    INSERT INTO material_fts(material_fts, rowid, name_tokens, tags_tokens, body_tokens)
    VALUES ('delete', old.rowid, old.name_tokens, old.tags_tokens, old.body_tokens);
END;
CREATE TRIGGER material_search_au AFTER UPDATE ON material_search BEGIN
    INSERT INTO material_fts(material_fts, rowid, name_tokens, tags_tokens, body_tokens)
    VALUES ('delete', old.rowid, old.name_tokens, old.tags_tokens, old.body_tokens);
    INSERT INTO material_fts(rowid, name_tokens, tags_tokens, body_tokens)
    VALUES (new.rowid, new.name_tokens, new.tags_tokens, new.body_tokens);
END;

CREATE TABLE library_operations (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    kind TEXT NOT NULL CHECK (kind IN ('save', 'insert', 'preview', 'backup')),
    phase TEXT NOT NULL CHECK (phase IN (
        'preparing', 'files_ready', 'committed', 'cancelled', 'failed', 'conflict'
    )),
    -- May identify a material not yet published, so intentionally not an FK.
    material_id TEXT,
    revision INTEGER,
    project_id TEXT,
    owner_nonce TEXT NOT NULL,
    intent_json TEXT NOT NULL CHECK (
        json_valid(intent_json) AND length(CAST(intent_json AS BLOB)) <= 2097152
    ),
    receipt_json TEXT CHECK (
        receipt_json IS NULL OR
        (json_valid(receipt_json) AND length(CAST(receipt_json AS BLOB)) <= 65536)
    ),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (kind <> 'insert' OR project_id IS NOT NULL),
    CHECK (phase <> 'committed' OR receipt_json IS NOT NULL)
) STRICT;

CREATE TABLE operation_blob_leases (
    operation_id TEXT NOT NULL REFERENCES library_operations(id) ON DELETE CASCADE,
    blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
    heartbeat_at INTEGER NOT NULL,
    PRIMARY KEY (operation_id, blob_sha256)
) STRICT;
CREATE INDEX operation_blob_leases_blob ON operation_blob_leases(blob_sha256);

CREATE INDEX materials_browse ON materials(deleted_at, kind, updated_at DESC, id);
CREATE INDEX materials_name ON materials(normalized_name, id);
CREATE INDEX materials_favorite ON materials(favorite, deleted_at, updated_at DESC);
CREATE INDEX library_operations_recovery ON library_operations(phase, updated_at);

CREATE TRIGGER material_revision_immutable
BEFORE UPDATE ON material_revisions BEGIN
    SELECT RAISE(ABORT, 'Material content revisions are immutable');
END;
CREATE TRIGGER revision_image_immutable
BEFORE UPDATE ON revision_images BEGIN
    SELECT RAISE(ABORT, 'Revision image mappings are immutable');
END;
CREATE TRIGGER blob_immutable BEFORE UPDATE ON blobs BEGIN
    SELECT RAISE(ABORT, 'Library source blobs are immutable');
END;
CREATE TRIGGER material_identity_immutable
BEFORE UPDATE OF id, kind, rowid ON materials BEGIN
    SELECT RAISE(ABORT, 'Material identity and kind are immutable');
END;

PRAGMA user_version = 1;
COMMIT;

-- Illustrative lexical branch only; the service also applies literal chunk
-- predicates, visibility filters, ranking tiers, and request-aware pagination.
-- SELECT m.id, m.name, bm25(material_fts, 8.0, 5.0, 1.0) AS score
-- FROM material_fts
-- JOIN materials AS m ON m.rowid = material_fts.rowid
-- WHERE material_fts MATCH :escaped_token_expression AND m.deleted_at IS NULL
-- ORDER BY score ASC, m.updated_at DESC, m.id ASC LIMIT :page_size;

-- Metadata updates require compare-and-swap plus projection refresh in the
-- SAME transaction. Zero affected rows is a conflict, never success.
-- UPDATE materials SET name = :name, normalized_name = :normalized_name,
--   metadata_version = metadata_version + 1, updated_at = :now
-- WHERE id = :id AND metadata_version = :expected_version AND deleted_at IS NULL;

-- GC candidates; execute only under the shared maintenance/publication lock
-- after resolving in-flight intent, history, backup and project journals.
-- SELECT b.sha256 FROM blobs b
-- WHERE NOT EXISTS (
--   SELECT 1 FROM revision_images i WHERE i.blob_sha256 = b.sha256
-- ) AND NOT EXISTS (
--   SELECT 1 FROM operation_blob_leases l WHERE l.blob_sha256 = b.sha256
-- );
