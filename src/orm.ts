import { sql, SQL } from "bun";
import { drizzle } from 'drizzle-orm/bun-sql';

const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_NAME = process.env.DB_NAME || "postgres";

interface BigInt {
    /** Convert to BigInt to string form in JSON.stringify */
    toJSON: () => string;
}
BigInt.prototype.toJSON = function () {
    return this.toString();
};

const pg = new SQL(`postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

export const db = drizzle(pg);

// User queries
export async function getUserByUsername(username: string): Promise<any> {
  const [user] = await pg`
    SELECT id, name, profile_image_path
    FROM users
    WHERE name = ${username}
    LIMIT 1
  `;
  return user || null;
}

export async function getUserById(id: number): Promise<any> {
  const [user] = await pg`
    SELECT id, name, profile_image_path
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return user || null;
}

export async function getPasswordHash(userId: number): Promise<string | null> {
  const [result] = await pg`
    SELECT password
    FROM passwords
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return result?.password || null;
}

export async function createUser(name: string, profileImagePath: string | null): Promise<any> {
  const [user] = await pg`
    INSERT INTO users (name, profile_image_path)
    VALUES (${name}, ${profileImagePath})
    RETURNING id
  `;
  return user;
}

export async function setUserPassword(userId: number, password: string): Promise<void> {
  await pg`
    INSERT INTO passwords (user_id, password)
    VALUES (${userId}, ${password})
  `;
}

// Video queries
export async function getVideoByPublicId(publicId: string): Promise<any> {
  const [video] = await pg`
    SELECT v.*, vi.path, vi.duration_seconds, vi.size_bytes, vi.width, vi.height
    FROM videos v
    LEFT JOIN video_info vi ON v.id = vi.video_id
    WHERE v.public_id = ${publicId} AND v.hidden = false
    LIMIT 1
  `;
  return video || null;
}

export async function createVideo(publicId: string, title: string, description: string | null, userId: number | null): Promise<any> {
  const [video] = await pg`
    INSERT INTO videos (public_id, title, description, user_id)
    VALUES (${publicId}, ${title}, ${description}, ${userId})
    RETURNING id
  `;
  return video;
}

export async function createVideoInfo(
  videoId: number,
  path: string,
  durationSeconds: number | null,
  sizeBytes: number | null,
  bitrateBps: number | null,
  codec: string,
  pixelFormat: string,
  width: number | null,
  height: number | null,
  fps: number | null,
  metadata: string
): Promise<void> {
  await pg`
    INSERT INTO video_info (
      video_id, path, duration_seconds, size_bytes, bitrate_bps,
      codec, pixel_format, width, height, fps, metadata
    )
    VALUES (
      ${videoId}, ${path}, ${durationSeconds}, ${sizeBytes}, ${bitrateBps},
      ${codec}, ${pixelFormat}, ${width}, ${height}, ${fps}, ${metadata}
    )
  `;
}

// Uploads table queries (with tus_id and upload_name)
export async function createUpload(
  userId: number,
  tusId: string,
  uploadName: string | null,
  videoId: number | null,
  state: string = 'created'
): Promise<any> {
  const [upload] = await pg`
    INSERT INTO uploads (user_id, tus_id, upload_name, video_id, state)
    VALUES (${userId}, ${tusId}, ${uploadName}, ${videoId}, ${state}::upload_state_type)
    RETURNING id
  `;
  return upload;
}

export async function getUploadById(id: number): Promise<any> {
  const [upload] = await pg`
    SELECT * FROM uploads
    WHERE id = ${id}
    LIMIT 1
  `;
  return upload || null;
}

export async function getUploadsByVideoId(videoId: number): Promise<any[]> {
  return await pg`
    SELECT * FROM uploads
    WHERE video_id = ${videoId}
    ORDER BY created_at DESC
  `;
}

export async function getUploadsByUserId(userId: number): Promise<any[]> {
  return await pg`
    SELECT * FROM uploads
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

export async function updateUploadVideoId(id: number, videoId: number): Promise<void> {
  await pg`
    UPDATE uploads
    SET video_id = ${videoId}
    WHERE id = ${id}
  `;
}

export async function updateUploadState(tusId: string, state: string): Promise<void> {
  await pg`
    UPDATE uploads
    SET state = ${state}::upload_state_type
    WHERE tus_id = ${tusId}
  `;
}

export async function getUploadByTusId(tusId: string): Promise<any> {
  const [upload] = await pg`
    SELECT * FROM uploads
    WHERE tus_id = ${tusId}
    LIMIT 1
  `;
  return upload || null;
}

export async function updateUploadName(id: number, uploadName: string): Promise<void> {
  await pg`
    UPDATE uploads
    SET upload_name = ${uploadName}
    WHERE id = ${id}
  `;
}

export async function deleteUpload(id: number): Promise<void> {
  await pg`
    DELETE FROM uploads
    WHERE id = ${id}
  `;
}

export async function deleteUploadByTusId(tusId: string): Promise<void> {
  await pg`
    DELETE FROM uploads
    WHERE tus_id = ${tusId}
  `;
}

export default pg;