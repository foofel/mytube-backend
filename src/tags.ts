import { and, desc, eq, ilike, inArray, like, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { db } from "./orm";
import { videos, videoTagMap, videoTags } from "./drizzle/schema";
import { videoTagsRelations } from "./drizzle/relations";
import { getValidVideo } from "./admin";

// Create video entry after successful upload
export async function searchTags(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const { input } = await req.json();
    const pattern = `%${(input ?? "").toLowerCase()}%`;

    const suggestions = await db
    .select({
        id: videoTags.id,
        tag: videoTags.tag,
        description: videoTags.description,
        usageCount: sql<number>`count(${videoTagMap.videoId})`.as("usage_count"),
    })
    .from(videoTags)
    .leftJoin(videoTagMap, eq(videoTagMap.tagId, videoTags.id))
    .where(sql`lower(${videoTags.tag}) like ${pattern}`)
    .groupBy(videoTags.id, videoTags.tag, videoTags.description)
    .orderBy(desc(sql`"usage_count"`))
    .limit(10);

    return Response.json(suggestions);

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
