import { and, desc, eq, getTableColumns, isNotNull, ne, or, sql } from 'drizzle-orm';
import { requireAuth, type User } from './auth';
import { transcodeInfo, users, videos, videoTagMap, videoTags } from './drizzle/schema';
import { db } from './orm';



interface VideoListSearchFilters {
  video_id?:string | null,
  user?:User | null,
  query?: string | null,
}

async function getVideoList(filters:VideoListSearchFilters) {
    // 'public' => everyone
    // 'shareable' => reachable but only if url known,
    // 'users' => if logged in (has account),
    // 'friends' => unused
    // 'private' => only uploader

    if(filters.query) {
      const needle = sql`public.norm_ci(${filters.query})`;

      await db.execute(sql`select set_limit(0.05)`);

      // Drizzle relational query; Drizzle will do the necessary joins/secondary fetches
      const rows = await db.query.videos.findMany({
        with: {
          user: true,                  // join user
          transcodeInfos: true,        // join transcode
          videoTagMaps: {
            columns: {},               // omit join columns
            with: { videoTag: true },
          },
        },
        extras: {
          score: sql<number>`
              5 * similarity(public.norm_ci(${videos.title}), ${needle})
              +   similarity(public.norm_ci(${videos.description}), ${needle})
            `.as("score"),
          sim: sql<number>`
              GREATEST(
                similarity(public.norm_ci(${videos.title}), ${needle}),
                similarity(public.norm_ci(${videos.description}), ${needle})
              )
            `.as("sim")
        },
        where: (v) =>
          and(
            eq(videos.ready, true),
            or(
              sql`public.norm_ci(${v.title}) % ${needle}`,
              sql`public.norm_ci(${v.description}) % ${needle}`,
            ),
            or(
              eq(videos.visibilityState, 'public'),
              filters.user ? eq(videos.userId, filters.user.id) : undefined,
              filters.user ? eq(videos.visibilityState, 'users') : undefined
            )
          ),
        // Order by our weighted score, then id desc as a tiebreaker
        orderBy: (v) => [
          desc(sql`
            5 * similarity(public.norm_ci(${v.title}), ${needle})
            +   similarity(public.norm_ci(${v.description}), ${needle})
          `),
          desc(v.id),
        ],
        limit: 50,
      });
      const public_videos = rows.map(({ videoTagMaps, ...v }) => ({
        ...v,
        tags: videoTagMaps.map((m) => m.videoTag), // Tag[]
        // optionally: keep only the “best” transcode (example)
        // bestTranscode: pickBest(v.transcodeInfos),
      }));

      return public_videos
    } else {
      const rows = await db.query.videos.findMany({
        where: and(
          eq(videos.ready, true),
          filters.video_id ? eq(videos.publicId, filters.video_id) : undefined,
          or(
            eq(videos.visibilityState, 'public'),
            filters.user ? eq(videos.userId, filters.user.id) : undefined,
            filters.user ? eq(videos.visibilityState, 'users') : undefined
          )
        ),
        orderBy: [desc(videos.createdAt)],
        with: {
          user: true, // pulls the whole user row (rename later if you wish)
          transcodeInfos: true, // all transcodeInfo rows for the video
          videoTagMaps: {
            columns: {},          // omit join columns
            with: { videoTag: true },
          },
        },
      });

      const public_videos = rows.map(({ videoTagMaps, ...v }) => ({
        ...v,
        tags: videoTagMaps.map((m) => m.videoTag), // Tag[]
        // optionally: keep only the “best” transcode (example)
        // bestTranscode: pickBest(v.transcodeInfos),
      }));

      return public_videos
    }
}

// get a global list of all videos that the request can currently see
export async function getLandingPageVideos(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  try {
    const videoList = await getVideoList({ user: user });
    return Response.json(videoList);
  } catch (error) {
    console.error("Get video info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });;
  }
}

export async function getSearchResultVideos(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  try {
    const { searchParams } = new URL(req.url)
    const videoList = await getVideoList({ user: user, query: searchParams.get("query") });
    return Response.json(videoList);
  } catch (error) {
    console.error("Get video info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });;
  }
}

// get one video result detail info
export async function getVideoInfoForVideoPage(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  try {
    const public_id = req.params.public_id;
    const videoList = await getVideoList({ user: user, video_id: public_id });
    return Response.json(videoList);
  } catch (error) {
    console.error("Get video info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function addVideoLike(req: Request): Promise<Response> {
  const public_id = req.params.public_id;
  if(!public_id) {
    return Response.json(null, {status: 400});
  }
  let [ likes ] = await db.update(videos)
    .set({ likes: sql`${videos.likes} + 1` })
    .where(eq(videos.publicId, public_id))
    .returning({ likes: videos.likes })
  if(!likes) {
    return Response.json(null, {status: 404});
  }
  return Response.json(likes?.likes ?? 0);
}

export async function removeVideoLike(req: Request): Promise<Response> {
  const public_id = req.params.public_id;
  if(!public_id) {
    return Response.json(null, {status: 400});
  }
  let [ likes ] = await db.update(videos)
    .set({ likes: sql`greatest(${videos.likes} - 1, 0)` })
    .where(eq(videos.publicId, public_id))
    .returning({ likes: videos.likes })
  if(!likes) {
    return Response.json(null, {status: 404});
  }
  return Response.json(likes?.likes ?? 0);
}

export async function addVideoDislike(req: Request): Promise<Response> {
  const public_id = req.params.public_id;
  if(!public_id) {
    return Response.json(null, {status: 400});
  }
  let [ dislikes ] = await db.update(videos)
    .set({ dislikes: sql`${videos.dislikes} + 1` })
    .where(eq(videos.publicId, public_id))
    .returning({ dislikes: videos.dislikes })
  if(!dislikes) {
    return Response.json(null, {status: 404});
  }
  return Response.json(dislikes?.dislikes ?? 0);
}

export async function removeVideoDislike(req: Request): Promise<Response> {
  const public_id = req.params.public_id;
  if(!public_id) {
    return Response.json(null, {status: 400});
  }
  let [ dislikes ] = await db.update(videos)
    .set({ dislikes: sql`greatest(${videos.dislikes} - 1, 0)` })
    .where(eq(videos.publicId, public_id))
    .returning({ dislikes: videos.dislikes })
  if(!dislikes) {
    return Response.json(null, {status: 404});
  }
  return Response.json(dislikes?.dislikes ?? 0);
}

export async function addVideoView(req: Request): Promise<Response> {
  const public_id = req.params.public_id;
  if(!public_id) {
    return Response.json(null, {status: 400});
  }
  let [ views ] = await db.update(videos)
    .set({ views: sql`${videos.views} + 1` })
    .where(eq(videos.publicId, public_id))
    .returning({ views: videos.views })
  if(!views) {
    return Response.json(null, {status: 404});
  }
  return Response.json(views?.views ?? 0);
}