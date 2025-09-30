import { and, desc, eq, isNotNull, ne, or } from 'drizzle-orm';
import { requireAuth, type User } from './auth';
import { transcodeInfo, transcodeJobs, uploads, users, videos } from './drizzle/schema';
import { db } from './orm';
import fs from 'node:fs/promises';

// Create video entry after successful upload
export async function getVideo(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const video = await db.query.videos.findMany({
        where: eq(videos.publicId, public_id),
        with: {
            transcodeInfos: true
        }
    })
    return Response.json(video);
  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Create video entry after successful upload
export async function updateVideo(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const body = await req.json();
    const {
      title,
      description,
      tags,
      visibilityState,
      extractGps,
      linkYoutube,
      linkInstagram,
      shareToYoutube,
      shareToInstagram
    } = body
    console.log(`updating video`, body);

    const [ video ] = await db.update(videos).set({
        title: title,
        description: description,
        visibilityState: visibilityState,
    }).where(eq(videos.id, public_id)).returning();

    return Response.json(video);

  } catch (error) {
    console.error("Create video entry error:", error);
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

    let video = await db.transaction(async (tx) => {
      const [ video ] = await tx.select().from(videos).where(eq(videos.publicId, public_id));
      const [ upload ] = await tx.select().from(uploads).where(eq(uploads.videoId, video!.id));
      const [ transcodeJob ] = await tx.select().from(transcodeJobs).where(eq(transcodeJobs.uploadId, upload!.id));
      if(!transcodeJob?.inputPath) {
        console.error(`unable to delete video, tus upload not found`, video, upload, transcodeJob);
        return
      }
      if(!transcodeJob.inputPath.startsWith("./data/uploads")) {
        console.error(`unable to delete video, '${transcodeJob.inputPath}' not in './data/uploads/'`, transcodeJob);
        return
      }
      await fs.unlink(transcodeJob.inputPath);
      await tx.delete(transcodeJobs).where(eq(videos.publicId, public_id));
      await tx.delete(transcodeInfo).where(eq(videos.publicId, public_id));
      await tx.delete(uploads).where(eq(uploads.videoId, public_id));
      await tx.delete(videos).where(eq(videos.publicId, public_id));
      return video
    });

    return Response.json(true);

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
  const my_videos = await db.query.videos.findMany({
    with: {
        transcodeInfos: true,
        uploads: {
            columns: {
                state: true
            },
            with:  {
                transcodeJobs: {
                    columns: {
                        state: true,
                    }
                }
            }
        }
    },
    orderBy: [ desc(videos.createdAt) ]
  });
  return Response.json(my_videos);
}

export async function getVideoByTusID(req: Request) {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const tus_id = req.params.tus_id;
  const my_videos = await db.select({ videos }).from(videos).innerJoin(uploads, eq(videos.id, uploads.videoId)).where(
    and(
      eq(uploads.userId, user.id),
      eq(uploads.tusId, tus_id)
    )
  );
  return Response.json(my_videos[0]);
}

export function generatePublicId(): string {
  // Generate YouTube-like ID
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < 11; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
