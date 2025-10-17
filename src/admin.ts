import { and, desc, eq, isNotNull, ne, or, inArray, sql } from 'drizzle-orm';
import { requireAuth, type User } from './auth';
import { transcodeInfo, transcodeJobs, uploads as uploads_schema, users, videos, videoTags, videoTagMap, uploads } from './drizzle/schema';
import { db } from './orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getTableColumns } from "drizzle-orm";
import { notifyNewVideo } from './notifications';


export function generatePublicId(): string {
  // Generate YouTube-like ID
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < 11; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Convert uploaded image to AVIF poster variants using Sharp
 */
async function convertPosterToAVIF(videoDir: string, imageFile: File): Promise<void> {
  // Ensure video directory exists
  await fs.mkdir(videoDir, { recursive: true });

  // Save uploaded image as lossless PNG
  const posterSrc = path.join(videoDir, 'poster_lossless_user.png');
  await Bun.write(posterSrc, imageFile);

  // AVIF conversion configurations (matching transcode.sh)
  // Note: Sharp's effort maps to quality/compression speed (0=fastest, 9=slowest)
  // CRF in ffmpeg ~ quality in Sharp (lower CRF = higher quality, higher Sharp quality = higher quality)
  const configs = [
    { width: 854, name: 'poster_480p', quality: 80, effort: 3 },
    { width: 1280, name: 'poster_720p', quality: 80, effort: 3 },
    { width: 1920, name: 'poster_1080p', quality: 80, effort: 3 },
    { width: 2560, name: 'poster_1440p', quality: 80, effort: 3 },
    { width: 3840, name: 'poster_2160p', quality: 80, effort: 3 },
  ];

  // Convert all variants in parallel for better performance
  await Promise.all(
    configs.map(async (config) => {
      const outputPath = path.join(videoDir, `${config.name}.avif`);
      await sharp(posterSrc)
        .resize(config.width, null, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: 'lanczos3',
        })
        .avif({
          quality: config.quality,
          effort: config.effort,
        })
        .toFile(outputPath);
    })
  );
}

export async function getValidAdminVideo(user:User, public_id:string|null, tus_id:string|null = null): Promise<{type: 'response', data: Response}|{type: 'video', data: any}> {
    if(!user) {
      return { type: 'response', data: Response.json(null, { status: 400 }) };
    }

    let video = null
    if(tus_id) {
      const u = await db.query.uploads.findFirst({
        where: and(
          eq(uploads.tusId, tus_id),
          eq(uploads.userId, user.id)
        ),
        with: {
          video: {
            with: {
              videoTagMaps: {
                columns: {},       // skip join table fields
                with: { videoTag: true },
              }
            }
          }
        },
      });

      if(!u) {
        return { type: 'response', data: Response.json(null, { status: 404 }) };
      }

      const { video: { videoTagMaps, ...videoRest }, tusInfo } = u
      video = {
        ...videoRest,
        upload: { tusInfo: { id: tusInfo.id, metadata: tusInfo.metadata }},
        tags: videoTagMaps.map(m => m.videoTag),
      };
    }
    else {
      const v = await db.query.videos.findFirst({
        where: and(
          public_id ? eq(videos.publicId, public_id) : undefined,
          eq(videos.userId, user.id)
        ),
        with: {
          uploads: true,
          videoTagMaps: {
            columns: {},       // skip join table fields
            with: { videoTag: true },
          },
        },
      });

      if(!v) {
        return { type: 'response', data: Response.json(null, { status: 404 }) };
      }
      const { videoTagMaps, uploads, ...videoRest } = v
      const { tusInfo, state, ...uploadRest } = uploads[0];
      video = {
        ...videoRest,
        upload: { tusInfo: { id: tusInfo.id, metadata: tusInfo.metadata, state: state }},
        tags: v.videoTagMaps.map(m => m.videoTag),
      };
    }

    return { type: 'video', data: video };
}

export async function getValidAdminVideos(user:User): Promise<Array<typeof videos.$inferSelect>> {
    const va = await db.query.videos.findMany({
      where: and(
        eq(videos.userId, user.id)
      ),
      with: {
        //transcodeInfos: true,
        uploads: {
          with:  {
              transcodeJobs: {
                  columns: {
                      state: true,
                  }
              }
          }
        },
        videoTagMaps: {
          columns: {},       // skip join table fields
          with: { videoTag: true },
        },
      },
      orderBy: [ desc(videos.createdAt) ]
    });

    const video_list = [];
    for (const v of va) {
      const { videoTagMaps, uploads, ...videoRest } = v
      const { tusInfo, state, transcodeJobs, ...uploadRest } = uploads[0];
      const video = {
        ...videoRest,
        upload: { tusInfo: { id: tusInfo.id, metadata: tusInfo.metadata, state: state }, transcodeJobs: transcodeJobs },
        tags: v.videoTagMaps.map(m => m.videoTag),
      };
      video_list.push(video)
    }

    return video_list;
}

export async function getVideo(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const { type, data } = await getValidAdminVideo(user, public_id);
    if(type === 'response') {
      return data
    }
    return Response.json(data);
  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function updateVideo(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const { type, data } = await getValidAdminVideo(user, public_id);
    if(type === 'response') {
      return data
    }
    let video = data;

    // Parse FormData to support file uploads
    const formData = await req.formData();

    // Extract JSON fields
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const visibilityState = formData.get('visibilityState') as string | null;
    const posterImage = formData.get('posterImage') as File | null;
    const tags = formData.get('tags') as string | null;

    // Handle poster image upload if provided
    let posterImagePath: string | null = null;
    if (posterImage && posterImage.size > 0) {
      // Validate image type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];
      if (!validTypes.includes(posterImage.type)) {
        return Response.json(
          { error: "Invalid image type. Supported formats: JPEG, PNG, WebP, AVIF" },
          { status: 400 }
        );
      }

      // Get video output directory
      const videoDir = path.join('./data/videos', public_id);

      try {
        // Convert and save poster variants
        await convertPosterToAVIF(videoDir, posterImage);
        // Store reference to poster files (we'll use the base name, frontend can choose resolution)
        //posterImagePath = `${public_id}/poster`;
      } catch (conversionError) {
        console.error("Poster conversion error:", conversionError);
        return Response.json(
          { error: "Failed to process poster image" },
          { status: 500 }
        );
      }
    }

    if(tags !== null) {
      const tag_objects = JSON.parse(tags) as Array<{id?:number, tag?:string}>;
      const tags_by_id = tag_objects.filter((t:any) => t.id !== undefined && t.id != null);
      const new_tags = tag_objects.filter((t:any) => t.id === undefined || t.id === null).map((t) => {
        return { tag: t.tag!.trim() }
      });
      const duplicate_tags = new_tags.length > 0 ? await db.select().from(videoTags).where(inArray(sql`lower(${videoTags.tag})`, new_tags.map(t => t.tag!.toLowerCase()))) : [];
      const tags_to_create = new_tags.filter((nt) => {
        return !duplicate_tags.find((et) => nt.tag?.toLowerCase() === et.tag.toLowerCase())
      });
      const tags_to_connect = tags_by_id.concat(duplicate_tags)
      await db.transaction(async (tx) => {
        if(tags_to_create.length > 0) {
          const new_tag_ids = await tx.insert(videoTags).values(tags_to_create.map((t) => { return { tag: t.tag! } })).returning();
          await tx.insert(videoTagMap).values(new_tag_ids.map((t) => { return { videoId: video.id, tagId: t.id }}));
          tags_to_connect.push(...new_tag_ids);
        }
        // we simply remove all tags and create the ones we got new, if its an empty array we simply
        // wont have tags anymore
        await tx.delete(videoTagMap).where(eq(videoTagMap.videoId, video.id));
        if(tags_to_connect.length > 0) {
          await tx.insert(videoTagMap).values(tags_to_connect.map((t) => { return { videoId: video.id, tagId: t.id! }}));
        }
      });
    }

    // Build update object with only provided fields
    const updateData: any = {};
    if (title !== null) updateData.title = title;
    if (description !== null) updateData.description = description;
    if (visibilityState !== null) updateData.visibilityState = visibilityState;
    //if (posterImagePath !== null) updateData.posterImage = posterImagePath;

    // Check if video is becoming public or users (was private/shareable/friends before)
    const wasNotPublicOrUsers = video.visibilityState !== 'public' && video.visibilityState !== 'users';
    const becomingPublicOrUsers = visibilityState === 'public' || visibilityState === 'users';

    if(Object.keys(updateData).length > 0) {
      const [ updated ] = await db.update(videos).set(updateData).where(
            eq(videos.id, video.id)
      ).returning();

      // Send notification if video just became public or users AND is ready
      if (wasNotPublicOrUsers && becomingPublicOrUsers && video.ready) {
        // Don't await - send notifications in background
        notifyNewVideo(video.id, video.userId).catch(err =>
          console.error('Error sending new video notifications:', err)
        );
      }

      // we simply query the updated video again
      const { type, data } = await getValidAdminVideo(user, public_id);
      if(type === 'response') {
        return data
      }
      return Response.json(data);
    }
    return Response.json(video);

  } catch (error) {
    console.error("Update video error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function deleteVideo(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const { type, data } = await getValidAdminVideo(user, public_id);
    if(type === 'response') {
      return data
    }
    let video = data;

    await db.transaction(async (tx) => {
      const [ upload ] = await tx.select().from(uploads).where(eq(uploads.videoId, video!.id));
      const [ transcodeJob ] = await tx.select().from(transcodeJobs).where(eq(transcodeJobs.uploadId, upload!.id));
      await tx.delete(transcodeJobs).where(eq(transcodeJobs.uploadId, upload!.id));
      await tx.delete(transcodeInfo).where(eq(transcodeInfo.videoId, video.id));
      await tx.delete(uploads).where(eq(uploads.videoId, video.id));
      await tx.delete(videos).where(eq(videos.id, video.id));
      if(transcodeJob) {
        if (!(await fs.exists(transcodeJob?.outputPath))){
          console.error(`unable to remove transcode output dir (not found)`, transcodeJob?.outputPath);
        }
        await fs.rm(transcodeJob?.outputPath, { recursive: true, force: true }).catch((e:any) => console.error(e));
        await fs.unlink(transcodeJob?.inputPath).catch((e:any) => console.error(e));
        await fs.unlink(`${transcodeJob?.inputPath}.json`).catch((e:any) => console.error(e));
      } else {
        console.error(`no transcode job found for upload, not deleting any files`, upload)
      }
    });

    return Response.json(video);

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function getOwnVideos(req: Request) {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const my_videos = await getValidAdminVideos(user);
  return Response.json(my_videos);
}

export async function getVideoByTusID(req: Request) {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const tus_id = req.params.tus_id;
  const { type, data } = await getValidAdminVideo(user, null, tus_id);
  if(type === 'response') {
    return data
  }
  return Response.json(data);
}

// Create video entry after successful upload
export async function setVideoTags(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const { type, data } = await getValidAdminVideo(user, public_id);
    if(type === 'response') {
      return data
    }
    let video = data;

    /*
      expect:
      [
         { id: 1 },
         { id: 3 },
         { tag: "ulala" }, <- creates new tag
      ]
    */
    const tags = await req.json() as Array<{id?:number, tag?:string}>;
    const tags_to_add = tags.filter((t:any) => t.id !== undefined);
    const requested_new_tags = tags.filter((t:any) => t.tag !== undefined).map((t) => {
      return { tag: t.tag!.trim() }
    });
    // compare in lower case but add with upper case
    // we will only add tags that re not found and create a connection for existing tags
    const existing_tags = await db.select().from(videoTags).where(inArray(sql`lower(${videoTags.tag})`, requested_new_tags.map(t => t.tag!.toLowerCase())));
    const tags_to_create = requested_new_tags.filter((nt) => {
      return !existing_tags.find((et) => nt.tag?.toLowerCase() === et.tag.toLowerCase())
    });

    let connected_tag_ids = await db.transaction(async (tx) => {
      const connected_tags = tags_to_add.concat(existing_tags)
      if(tags_to_create.length > 0) {
        const new_tag_ids = await tx.insert(videoTags).values(tags_to_create.map((t) => { return { tag: t.tag! } })).returning();
        await tx.insert(videoTagMap).values(new_tag_ids.map((t) => { return { videoId: video.id, tagId: t.id }}));
        connected_tags.push(...new_tag_ids);
      }
      if(existing_tags.length > 0) {
        await tx.insert(videoTagMap).values(existing_tags.map((t) => { return { videoId: video.id, tagId: t.id }})).onConflictDoNothing({
          target: [videoTagMap.videoId, videoTagMap.tagId]
        });
      }
      if(tags_to_add.length > 0) {
        await tx.insert(videoTagMap).values(tags_to_add.map((t) => { return { videoId: video.id, tagId: t.id! }})).onConflictDoNothing({
          target: [videoTagMap.videoId, videoTagMap.tagId]
        });
      }
      //const connected_tag_ids = connected_tags.map((t:any) => t.id)
      const all_tags = await tx.select(videoTags).from(videoTags).innerJoin(videoTagMap, eq(videoTagMap.tagId, videoTags.id)).where(eq(videoTagMap.videoId, video.id));
      return all_tags
    });

    return Response.json(connected_tag_ids);

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Create video entry after successful upload
export async function removeVideoTags(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    /*
      expect:
      [
         { id: 1 },
         { id: 3 },
         { id: 24 },
      ]
    */
    const public_id = req.params.public_id;
    const { type, data } = await getValidAdminVideo(user, public_id);
    if(type === 'response') {
      return data
    }
    let video = data;

    const tags = await req.json() as Array<{id?:number, tag?:string}>;
    const tags_to_disconnect = tags.filter((t) => t.id !== undefined).map((t) => t.id!);
    await db.delete(videoTagMap).where(
      and(
        eq(videoTagMap.videoId, video.id),
        inArray(videoTagMap.tagId, tags_to_disconnect)
      )
    );
    const all_tags = await db.select(videoTags).from(videoTags).innerJoin(videoTagMap, eq(videoTagMap.tagId, videoTags.id)).where(eq(videoTagMap.videoId, video.id));
    return Response.json(all_tags);

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}