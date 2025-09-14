import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { requireAuth } from './auth';
import { transcodeInfo, users, videos } from './drizzle/schema';
import { db } from './orm';

export async function getVideos(req: Request): Promise<Response> {
  try {
    let public_videos = await db.select({
      id: videos.id,
      publicId: videos.publicId,
      title: videos.title,
      description: videos.description,
      likes: videos.likes,
      dislikes: videos.dislikes,
      views: videos.views,
      userId: videos.userId,
      createdAt: transcodeInfo.createdAt,
      updatedAt: transcodeInfo.updatedAt,
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
      user: users
    }).from(videos)
    .leftJoin(transcodeInfo, eq(transcodeInfo.videoId, videos.id))
    .leftJoin(users, eq(users.id, videos.userId))
    .where(
      and(
        isNotNull(videos.publicId),
        eq(videos.hidden, false)
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
      seen_users[video.user.id] = video.user;
      found_merge_group.streams.push(video.streamInfo)
      merged_streams[video.id] = found_merge_group
    }
    const video_list = Object.entries(merged_streams).map( e => e[1])
    const video_list_sorted = video_list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) // desc

    return Response.json({
      videos: video_list_sorted,
      users: seen_users
    })
  } catch (error) {
    console.error("Get video info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Get video metadata
export async function getVideoEntry(req: Request): Promise<Response> {
  try {
    const public_id = req.params.id;
    let public_videos = await db.select({
      id: videos.id,
      publicId: videos.publicId,
      title: videos.title,
      description: videos.description,
      likes: videos.likes,
      dislikes: videos.dislikes,
      views: videos.views,
      userId: videos.userId,
      createdAt: transcodeInfo.createdAt,
      updatedAt: transcodeInfo.updatedAt,
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
      user: users
    }).from(videos)
    .leftJoin(transcodeInfo, eq(transcodeInfo.videoId, videos.id))
    .leftJoin(users, eq(users.id, videos.userId))
    .where(
      and(
        isNotNull(videos.publicId),
        eq(videos.hidden, false),
        eq(videos.publicId, public_id)
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
      seen_users[video.user.id] = video.user;
      found_merge_group.streams.push(video.streamInfo)
      merged_streams[video.id] = found_merge_group
    }
    const video_list = Object.entries(merged_streams).map( e => e[1])
    const video_list_sorted = video_list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) // desc

    return Response.json({
      videos: video_list_sorted,
      users: seen_users
    })
  } catch (error) {
    console.error("Get video info error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Create video entry after successful upload
export async function updateVideoEntry(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    //const body = await req.json();
    //const { title, description } = body;
    //const tus_id = req.params.id;
    //await db.

    return Response.json({});

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
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