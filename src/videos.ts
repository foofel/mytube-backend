import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import { requireAuth, type User } from './auth';
import { transcodeInfo, users, videos } from './drizzle/schema';
import { db } from './orm';



interface VideoListSearchFilters {
  video_id?:string | null,
  user?:User | null,
}

async function getVideoList(filters:VideoListSearchFilters) {
    // 'public' => everyone
    // 'shareable' => reachable but only if url known,
    // 'users' => if logged in (has account),
    // 'friends' => unused
    // 'private' => only uploader
    let public_videos = await db.select({
      id: videos.id,
      publicId: videos.publicId,
      title: videos.title,
      description: videos.description,
      ext_ref: videos.extRef,
      gps: videos.gps,
      poster: videos.posterImage,
      likes: videos.likes,
      dislikes: videos.dislikes,
      views: videos.views,
      userId: videos.userId,
      createdAt: videos.createdAt,
      updatedAt: videos.updatedAt,
      streamInfo: {
        id: transcodeInfo.id,
        videoId: transcodeInfo.videoId,
        path: transcodeInfo.path,
        duration: transcodeInfo.duration,
        sizeBytes: transcodeInfo.sizeBytes,
        bitrateKbps: transcodeInfo.bitrateKbps,
        videoCodec: transcodeInfo.videoCodec,
        audioCodec: transcodeInfo.audioCodec,
        pixelFormat: transcodeInfo.pixelFormat,
        width: transcodeInfo.width,
        height: transcodeInfo.height,
        fps: transcodeInfo.fps,
        metadata: transcodeInfo.metadata,
        createdAt: transcodeInfo.createdAt,
        updatedAt: transcodeInfo.updatedAt,
      },
      users: users
    }).from(videos)
    .innerJoin(users, eq(users.id, videos.userId))
    .innerJoin(transcodeInfo, eq(transcodeInfo.videoId, videos.id))
    .where(
      and(
        eq(videos.ready, true),
        filters.video_id ? eq(videos.publicId, filters.video_id) : undefined,
        or(
          eq(videos.visibilityState, 'public'),
          filters.user ? eq(videos.userId, filters.user.id) : undefined,
          // no friends system yet
          // no shareable system yet
          filters.user ? eq(videos.visibilityState, 'users') : undefined
        )
      )
    );

    const seen_users = {}
    const merged_streams = {}
    for(const video of public_videos) {
      const found_merge_group = merged_streams[video.id] || (() => {
        let initial = { ...video, streams: [] }
        delete initial.streamInfo
        delete initial.user
        return initial
      })()
      seen_users[video.users.id] = video.users;
      found_merge_group.streams.push(video.streamInfo)
      merged_streams[video.id] = found_merge_group
    }
    const video_list = Object.entries(merged_streams).map( e => e[1])
    const video_list_sorted = video_list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) // desc

    return {
      videos: video_list_sorted,
      users: seen_users
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