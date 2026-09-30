// Bounded clipboard/derived-image transport only. Original file imports have no byte cap.
export const MATERIAL_IMAGE_MAX_BYTES = 64 * 1024 * 1024;
export const MATERIAL_IMAGE_MAX_DATA_URL_LENGTH = Math.ceil(MATERIAL_IMAGE_MAX_BYTES / 3) * 4 + 64;
