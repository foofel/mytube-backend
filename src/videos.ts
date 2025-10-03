import { and, desc, eq, getTableColumns, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { requireAuth, type User } from './auth';
import { transcodeInfo, users, videos, videoTagMap, videoTags } from './drizzle/schema';
import { db } from './orm';



interface VideoListSearchFilters {
  requestUser?:User | null,
  query?: string | null,
  tags?: Array<number>
}

async function searchVideos(filters:VideoListSearchFilters) {
  const tagIds = filters.tags ?? []
  const tagFilteredVideosSubq = db
    .select({ videoId: videoTagMap.videoId })
    .from(videoTagMap)
    .where(inArray(videoTagMap.tagId, tagIds))
    .groupBy(videoTagMap.videoId)
    // add having will turn the query from "match any id" to "match exact id(s)"
    //.having(sql`count(${videoTagMap.tagId}) = ${tagIds.length}`);
  const needle = sql`public.norm_ci(${filters.query})`;
  const extras = {
    score: sql<number>`
        similarity(public.norm_ci(${videos.title}), ${needle})
      `.as("score"),
    sim: sql<number>`
        GREATEST(
          similarity(public.norm_ci(${videos.title}), ${needle})
        )
      `.as("sim")
  }
  const similarity = sql`public.norm_ci(${videos.title}) % ${needle}`
  const orderBySimilarity = [
    desc(sql`
      similarity(public.norm_ci(${videos.title}), ${needle})
    `),
    desc(videos.createdAt),
  ]
  const accessRights = or(
    filters.requestUser ? eq(videos.userId, filters.requestUser.id) : undefined,
    filters.requestUser ? eq(videos.visibilityState, 'users') : undefined,
    eq(videos.visibilityState, 'public'),
  )
  const searchFilter = or(
    tagIds.length ? inArray(videos.id, tagFilteredVideosSubq) : undefined,
    filters.query ? similarity : undefined
  )

  // Drizzle relational query; Drizzle will do the necessary joins/secondary fetches
  const rows = await db.query.videos.findMany({
    with: {
      user: true,
      transcodeInfos: true,
      videoTagMaps: {
        columns: {},
        with: {
          videoTag: true
        },
      },
    },
    extras: filters.query ? extras : undefined,
    where: (v) =>
      and(
        eq(videos.ready, true),
        searchFilter,
        accessRights
      ),
    // Order by our weighted score, then id desc as a tiebreaker
    orderBy: filters.query ? orderBySimilarity : desc(videos.createdAt),
    limit: 50,
  });
  const public_videos = rows.map(({ videoTagMaps, ...v }) => ({
    ...v,
    tags: videoTagMaps.map((m) => m.videoTag), // Tag[]
    // optionally: keep only the “best” transcode (example)
    // bestTranscode: pickBest(v.transcodeInfos),
  }));

  return public_videos
}

async function getVideo(user:User|null, public_id:string) {
  const rows = await db.query.videos.findMany({
    where: and(
      eq(videos.ready, true),
      eq(videos.publicId, public_id),
      or(
        user ? eq(videos.userId, user.id) : undefined,
        user ? eq(videos.visibilityState, 'users') : undefined,
        // TODO: or we are friends
        eq(videos.visibilityState, 'public'),
        eq(videos.visibilityState, 'shareable'),
      )
    ),
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
  }));

  return public_videos
}

// get a global list of all videos that the request can currently see
export async function getLandingPageVideos(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  try {
    const videoList = await searchVideos({ requestUser: user });
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
    const tags = searchParams.get("tags")?.split(",").map(t => parseInt(t)).filter(t => !Number.isNaN(t));
    const videoList = await searchVideos({ requestUser: user, query: searchParams.get("query"), tags: tags });
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
    const videoList = await getVideo(user, public_id);
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