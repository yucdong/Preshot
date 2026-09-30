-- This script runs in one transaction with foreign keys checked before commit.
-- Keep the original table name so all image instances, receipts and owners retain
-- their existing identities and foreign-key targets.
DROP TRIGGER material_asset_image;
DROP TRIGGER material_instance_receipt;
CREATE TABLE blobs_v7 (
    hash TEXT PRIMARY KEY NOT NULL CHECK(length(hash) = 64),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
    byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 67108864),
    width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192),
    height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192),
    CHECK(width * height <= 32000000)
) STRICT;
INSERT INTO blobs_v7 SELECT hash,mime_type,byte_length,width,height FROM blobs;
DROP TABLE blobs;
ALTER TABLE blobs_v7 RENAME TO blobs;
CREATE TRIGGER immutable_blob BEFORE UPDATE ON blobs BEGIN
    SELECT RAISE(ABORT,'Material source blobs are immutable');
END;
CREATE TRIGGER material_asset_image AFTER INSERT ON material_images BEGIN
    INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
    SELECT new.material_id,'object',new.blob_hash,mime_type FROM blobs
    WHERE hash=new.blob_hash AND new.storage_id IS NULL
    ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING;
    INSERT INTO material_instance_owners(material_id,storage_id)
    SELECT new.material_id,new.storage_id WHERE new.storage_id IS NOT NULL
    ON CONFLICT(material_id,storage_id) DO NOTHING;
END;
CREATE TRIGGER material_instance_receipt BEFORE INSERT ON edit_receipts
WHEN EXISTS (
    SELECT 1 FROM json_each(new.result_json,'$.images') j
    WHERE json_type(j.value,'$.storageId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM image_instances i JOIN blobs b ON b.hash=i.blob_hash
        WHERE i.storage_id=json_extract(j.value,'$.storageId')
          AND i.blob_hash=json_extract(j.value,'$.blobId')
          AND i.local_image_id=json_extract(j.value,'$.localImageId')
          AND b.mime_type=json_extract(j.value,'$.mimeType')))
BEGIN SELECT RAISE(ABORT,'Receipt instance integrity mapping differs'); END;
