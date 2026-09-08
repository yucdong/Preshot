PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS library_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS materials (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
    preview_hash TEXT,
    preview_render_key TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS blobs (
    hash TEXT PRIMARY KEY NOT NULL CHECK(length(hash) = 64),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
    byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 16777216),
    width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192),
    height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192),
    CHECK(width * height <= 32000000)
) STRICT;
CREATE TABLE IF NOT EXISTS material_images (
    material_id TEXT NOT NULL REFERENCES materials(id),
    local_image_id TEXT NOT NULL,
    blob_hash TEXT NOT NULL REFERENCES blobs(hash),
    position INTEGER NOT NULL,
    PRIMARY KEY(material_id, local_image_id),
    UNIQUE(material_id, position)
) STRICT;
CREATE TABLE IF NOT EXISTS save_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    intent_hash TEXT NOT NULL,
    material_id TEXT NOT NULL REFERENCES materials(id)
) STRICT;
CREATE TABLE IF NOT EXISTS edit_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    intent_hash TEXT NOT NULL CHECK(length(intent_hash) = 64),
    material_id TEXT NOT NULL REFERENCES materials(id),
    result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE TABLE IF NOT EXISTS material_asset_owners (
    material_id TEXT NOT NULL REFERENCES materials(id),
    kind TEXT NOT NULL CHECK(kind IN ('object','preview')),
    hash TEXT NOT NULL CHECK(length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
    CHECK(kind <> 'preview' OR mime_type = 'image/png'),
    PRIMARY KEY(material_id,kind,hash,mime_type)
) STRICT;
CREATE TABLE IF NOT EXISTS purge_receipts (
    material_id TEXT PRIMARY KEY NOT NULL,
    expected_version INTEGER NOT NULL CHECK(expected_version BETWEEN 1 AND 4294967295),
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1))
) STRICT;
CREATE TABLE IF NOT EXISTS purge_files (
    material_id TEXT NOT NULL REFERENCES purge_receipts(material_id),
    kind TEXT NOT NULL CHECK(kind IN ('object','preview')),
    hash TEXT NOT NULL CHECK(length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
    CHECK(kind <> 'preview' OR mime_type = 'image/png'),
    PRIMARY KEY(material_id,kind,hash,mime_type)
) STRICT;
CREATE TABLE IF NOT EXISTS purged_operations (
    operation_kind TEXT NOT NULL CHECK(operation_kind IN ('save','edit')),
    operation_id TEXT NOT NULL,
    intent_hash TEXT NOT NULL CHECK(length(intent_hash) = 64),
    material_id TEXT NOT NULL REFERENCES purge_receipts(material_id),
    PRIMARY KEY(operation_kind,operation_id)
) STRICT;
CREATE INDEX IF NOT EXISTS material_asset_hash ON material_asset_owners(kind,hash);
CREATE TRIGGER IF NOT EXISTS material_asset_image AFTER INSERT ON material_images BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.material_id,'object',new.blob_hash,mime_type FROM blobs WHERE hash=new.blob_hash
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS material_asset_preview BEFORE UPDATE OF preview_hash ON materials BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT old.id,'preview',old.preview_hash,'image/png' WHERE old.preview_hash IS NOT NULL
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.id,'preview',new.preview_hash,'image/png' WHERE new.preview_hash IS NOT NULL
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS material_asset_receipt AFTER INSERT ON edit_receipts BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.material_id,'object',json_extract(value,'$.blobId'),json_extract(value,'$.mimeType')
    FROM json_each(new.result_json,'$.images') WHERE true
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS purged_material_identity BEFORE INSERT ON materials
WHEN EXISTS(SELECT 1 FROM purge_receipts WHERE material_id=new.id)
BEGIN SELECT RAISE(ABORT,'Permanently deleted material identities cannot be reused'); END;
INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
SELECT i.material_id,'object',i.blob_hash,b.mime_type FROM material_images i JOIN blobs b ON b.hash=i.blob_hash
WHERE NOT EXISTS(SELECT 1 FROM library_meta WHERE key='asset_ownership_version')
ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
SELECT id,'preview',preview_hash,'image/png' FROM materials WHERE preview_hash IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM library_meta WHERE key='asset_ownership_version')
ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
SELECT r.material_id,'object',json_extract(j.value,'$.blobId'),json_extract(j.value,'$.mimeType')
FROM edit_receipts r,json_each(r.result_json,'$.images') j
WHERE NOT EXISTS(SELECT 1 FROM library_meta WHERE key='asset_ownership_version')
ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
INSERT OR IGNORE INTO library_meta(key,value) VALUES('asset_ownership_version','1');
CREATE TABLE IF NOT EXISTS material_search (
    rowid INTEGER PRIMARY KEY REFERENCES materials(rowid),
    name_raw TEXT NOT NULL,
    tags_raw TEXT NOT NULL,
    body_raw TEXT NOT NULL,
    name_tokens TEXT NOT NULL,
    tags_tokens TEXT NOT NULL,
    body_tokens TEXT NOT NULL
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS material_fts USING fts5(
    name_tokens, tags_tokens, body_tokens,
    content='material_search', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 0'
);
CREATE TRIGGER IF NOT EXISTS material_search_ai AFTER INSERT ON material_search BEGIN
    INSERT INTO material_fts(rowid,name_tokens,tags_tokens,body_tokens)
    VALUES(new.rowid,new.name_tokens,new.tags_tokens,new.body_tokens);
END;
CREATE TRIGGER IF NOT EXISTS material_search_ad AFTER DELETE ON material_search BEGIN
    INSERT INTO material_fts(material_fts,rowid,name_tokens,tags_tokens,body_tokens)
    VALUES('delete',old.rowid,old.name_tokens,old.tags_tokens,old.body_tokens);
END;
CREATE TRIGGER IF NOT EXISTS material_search_au AFTER UPDATE ON material_search BEGIN
    INSERT INTO material_fts(material_fts,rowid,name_tokens,tags_tokens,body_tokens)
    VALUES('delete',old.rowid,old.name_tokens,old.tags_tokens,old.body_tokens);
    INSERT INTO material_fts(rowid,name_tokens,tags_tokens,body_tokens)
    VALUES(new.rowid,new.name_tokens,new.tags_tokens,new.body_tokens);
END;
CREATE TRIGGER IF NOT EXISTS immutable_blob BEFORE UPDATE ON blobs BEGIN
    SELECT RAISE(ABORT,'Material source blobs are immutable');
END;
CREATE TRIGGER IF NOT EXISTS immutable_image BEFORE UPDATE ON material_images BEGIN
    SELECT RAISE(ABORT,'Material image mappings are immutable');
END;
DROP TRIGGER IF EXISTS immutable_content;
CREATE TRIGGER IF NOT EXISTS material_identity_insert BEFORE INSERT ON materials
WHEN json_extract(new.detail_json,'$.id') IS NOT new.id
    OR json_extract(new.detail_json,'$.kind') IS NOT new.kind
    OR json_extract(new.detail_json,'$.payload.kind') IS NOT new.kind
    OR json_type(new.detail_json,'$.revision') IS NOT 'integer'
    OR json_extract(new.detail_json,'$.revision') IS NOT 1
BEGIN SELECT RAISE(ABORT,'Invalid material identity or initial revision'); END;
DROP TRIGGER IF EXISTS revisioned_content;
CREATE TRIGGER revisioned_content BEFORE UPDATE OF detail_json ON materials
WHEN json_extract(new.detail_json,'$.id') IS NOT old.id
    OR json_extract(new.detail_json,'$.kind') IS NOT old.kind
    OR json_extract(new.detail_json,'$.payload.kind') IS NOT old.kind
    OR json_extract(new.detail_json,'$.createdAt') IS NOT json_extract(old.detail_json,'$.createdAt')
    OR json_type(new.detail_json,'$.revision') IS NOT 'integer'
    OR json_extract(new.detail_json,'$.revision') NOT BETWEEN 1 AND 4294967295
    OR json_extract(new.detail_json,'$.revision') NOT IN (
        json_extract(old.detail_json,'$.revision'), json_extract(old.detail_json,'$.revision') + 1)
    OR json_type(new.detail_json,'$.metadataVersion') IS NOT 'integer'
    OR json_extract(new.detail_json,'$.metadataVersion') NOT BETWEEN 1 AND 4294967295
    OR json_extract(new.detail_json,'$.metadataVersion') NOT IN (
        json_extract(old.detail_json,'$.metadataVersion'), json_extract(old.detail_json,'$.metadataVersion') + 1)
    OR (json_extract(new.detail_json,'$.metadataVersion') = json_extract(old.detail_json,'$.metadataVersion')
        AND (json_extract(new.detail_json,'$.name') IS NOT json_extract(old.detail_json,'$.name')
          OR json_extract(new.detail_json,'$.description') IS NOT json_extract(old.detail_json,'$.description')
          OR json_extract(new.detail_json,'$.tags') IS NOT json_extract(old.detail_json,'$.tags')
          OR json_extract(new.detail_json,'$.favorite') IS NOT json_extract(old.detail_json,'$.favorite')
          OR json_extract(new.detail_json,'$.deletedAt') IS NOT json_extract(old.detail_json,'$.deletedAt')))
    OR (json_extract(new.detail_json,'$.revision') = json_extract(old.detail_json,'$.revision')
        AND (json_extract(new.detail_json,'$.payload') IS NOT json_extract(old.detail_json,'$.payload')
          OR json_extract(new.detail_json,'$.images') IS NOT json_extract(old.detail_json,'$.images')))
    OR (json_extract(new.detail_json,'$.revision') = json_extract(old.detail_json,'$.revision') + 1
        AND (json_extract(old.detail_json,'$.deletedAt') IS NOT NULL
          OR json_extract(new.detail_json,'$.deletedAt') IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'Invalid material content revision or identity'); END;
CREATE TRIGGER IF NOT EXISTS immutable_identity BEFORE UPDATE OF id,kind,rowid ON materials BEGIN
    SELECT RAISE(ABORT,'Material identities are immutable');
END;
PRAGMA user_version = 4;
COMMIT;
