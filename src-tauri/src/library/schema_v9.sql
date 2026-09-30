-- Physical locations are separate from immutable image identities and receipts.
CREATE TABLE IF NOT EXISTS group_instance_locations (
    storage_id TEXT PRIMARY KEY NOT NULL,
    material_id TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
    blob_hash TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK(byte_length>0),
    relocating INTEGER NOT NULL CHECK(relocating IN (0,1))
) STRICT;
-- Pre-v5 hash objects can have multiple owners. Keep their exact receipts and
-- resolver, and own a separate compatibility copy in each group's directory.
CREATE TABLE IF NOT EXISTS group_legacy_files (
    material_id TEXT NOT NULL,
    local_image_id TEXT NOT NULL,
    blob_hash TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
    byte_length INTEGER NOT NULL CHECK(byte_length>0),
    ready INTEGER NOT NULL CHECK(ready IN (0,1)),
    PRIMARY KEY(material_id,local_image_id,blob_hash)
) STRICT;
PRAGMA user_version = 9;
