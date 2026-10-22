export type PhotoContentType = "photo";

export function parsePhotoContentType(value: unknown): PhotoContentType | null {
  return value === "photo" ? "photo" : null;
}
