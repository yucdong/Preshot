CREATE TABLE IF NOT EXISTS image_instances (
    storage_id TEXT PRIMARY KEY NOT NULL CHECK(
        length(storage_id)=36 AND storage_id NOT GLOB '*[^0-9a-f-]*'
        AND length(replace(storage_id,'-',''))=32
        AND substr(storage_id,9,1)='-' AND substr(storage_id,14,1)='-'
        AND substr(storage_id,19,1)='-' AND substr(storage_id,24,1)='-'),
    blob_hash TEXT NOT NULL REFERENCES blobs(hash),
    session_id TEXT NOT NULL CHECK(length(session_id)=36),
    local_image_id TEXT NOT NULL CHECK(length(local_image_id) BETWEEN 1 AND 128
        AND local_image_id NOT GLOB '*[^0-9A-Za-z_-]*'),
    UNIQUE(storage_id,blob_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS material_instance_owners (
    material_id TEXT NOT NULL REFERENCES materials(id),
    storage_id TEXT NOT NULL REFERENCES image_instances(storage_id),
    PRIMARY KEY(material_id,storage_id)
) STRICT;
CREATE TABLE IF NOT EXISTS purge_instance_files (
    material_id TEXT NOT NULL REFERENCES purge_receipts(material_id),
    storage_id TEXT NOT NULL CHECK(length(storage_id)=36),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
    blob_hash TEXT NOT NULL CHECK(length(blob_hash)=64 AND blob_hash NOT GLOB '*[^0-9a-f]*'),
    PRIMARY KEY(material_id,storage_id)
) STRICT;
CREATE TABLE IF NOT EXISTS instance_publications (
    storage_id TEXT PRIMARY KEY NOT NULL CHECK(length(storage_id)=36),
    session_id TEXT NOT NULL CHECK(length(session_id)=36),
    image_json TEXT NOT NULL CHECK(json_valid(image_json))
) STRICT;
CREATE TABLE IF NOT EXISTS snapshot_instance_saves (
    operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id)=36),
    intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64 AND intent_hash NOT GLOB '*[^0-9a-f]*'),
    material_id TEXT NOT NULL CHECK(length(material_id)=36),
    created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS instance_publication_image
    ON instance_publications(session_id,json_extract(image_json,'$.localImageId'));
CREATE INDEX IF NOT EXISTS instance_owner_storage ON material_instance_owners(storage_id);
CREATE INDEX IF NOT EXISTS instance_publication_session ON instance_publications(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS material_image_instance ON material_images(material_id,storage_id)
    WHERE storage_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS immutable_instance BEFORE UPDATE ON image_instances BEGIN
    SELECT RAISE(ABORT,'Material physical image instances are immutable');
END;
CREATE TRIGGER IF NOT EXISTS material_instance_mapping BEFORE INSERT ON material_images
WHEN new.storage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM image_instances WHERE storage_id=new.storage_id AND blob_hash=new.blob_hash
        AND local_image_id=new.local_image_id)
BEGIN SELECT RAISE(ABORT,'Image instance integrity mapping differs'); END;
CREATE TRIGGER IF NOT EXISTS material_instance_receipt BEFORE INSERT ON edit_receipts
WHEN EXISTS (
    SELECT 1 FROM json_each(new.result_json,'$.images') j
    WHERE json_type(j.value,'$.storageId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM image_instances i JOIN blobs b ON b.hash=i.blob_hash
        WHERE i.storage_id=json_extract(j.value,'$.storageId')
          AND i.blob_hash=json_extract(j.value,'$.blobId')
          AND i.local_image_id=json_extract(j.value,'$.localImageId')
          AND b.mime_type=json_extract(j.value,'$.mimeType')))
BEGIN SELECT RAISE(ABORT,'Receipt instance integrity mapping differs'); END;
DROP TRIGGER IF EXISTS material_asset_image;
CREATE TRIGGER material_asset_image AFTER INSERT ON material_images BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.material_id,'object',new.blob_hash,mime_type FROM blobs
    WHERE hash=new.blob_hash AND new.storage_id IS NULL
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
    INSERT INTO material_instance_owners(material_id,storage_id)
    SELECT new.material_id,new.storage_id WHERE new.storage_id IS NOT NULL
    ON CONFLICT(material_id,storage_id) DO NOTHING;
END;
DROP TRIGGER IF EXISTS material_asset_receipt;
CREATE TRIGGER material_asset_receipt AFTER INSERT ON edit_receipts BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.material_id,'object',json_extract(value,'$.blobId'),json_extract(value,'$.mimeType')
    FROM json_each(new.result_json,'$.images') WHERE json_type(value,'$.storageId') IS NULL
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
    INSERT INTO material_instance_owners(material_id,storage_id)
    SELECT new.material_id,json_extract(value,'$.storageId')
    FROM json_each(new.result_json,'$.images') WHERE json_type(value,'$.storageId') IS NOT NULL
    ON CONFLICT(material_id,storage_id) DO NOTHING;
END;
PRAGMA user_version = 5;
