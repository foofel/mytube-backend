import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { requireAuth } from "./auth";
import { db } from "./orm";
import { videos, videoTagMap, videoTags } from "./drizzle/schema";
import { videoTagsRelations } from "./drizzle/relations";

// Create video entry after successful upload
export async function searchTags(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const { input } = await req.json();

    // const suggestions = await db.select({
    //     id: videoTags.id,
    //     tag: videoTags.tag,
    //     description: videoTags.description,
    // }).from(videoTags).where(ilike(videoTags.tag, `%${input}%`)).limit(10);

    const suggestions = await db
    .select({
        id: videoTags.id,
        tag: videoTags.tag,
        description: videoTags.description,
        usageCount: sql<number>`count(${videoTagMap.videoId})`.as("usage_count"),
    })
    .from(videoTags)
    .leftJoin(videoTagMap, eq(videoTagMap.tagId, videoTags.id))
    .where(ilike(videoTags.tag, `%${input}%`))
    .groupBy(videoTags.id, videoTags.tag, videoTags.description)
    //.orderBy(sql`usage_count DESC`) // optional: sort by usage
    .limit(10);

    return Response.json(suggestions);

  } catch (error) {
    console.error("Create video entry error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Create video entry after successful upload
export async function setVideoTags(req: Request): Promise<Response> {
  try {
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const public_id = req.params.public_id;
    const [ video ] = await db.select().from(videos).where(eq(videos.publicId, public_id));
    if(!video) {
      return Response.json(null, { status: 404 });
    }

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
    const [ video ] = await db.select().from(videos).where(eq(videos.publicId, public_id));
    if(!video) {
      return Response.json(null, { status: 404 });
    }

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