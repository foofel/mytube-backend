import { requireAuth } from './auth';
import { mkdir, exists } from 'node:fs/promises';
import { join } from 'node:path';
import { Server, Upload } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { db } from './orm';
import type { ServerRequest } from 'srvx';
import { uploads, videos } from './drizzle/schema';
import { and, eq, ne } from 'drizzle-orm';
import { transcodeQueue } from './transcode';
import { generatePublicId } from './admin';

const tusServer = new Server({
  path: "/files",
  respectForwardedHeaders: true,
  datastore: new FileStore({
    directory: "./data/uploads",
    expirationPeriodInMilliseconds: 24*3600*1000*7
  }),

  onResponseError: async (req, err) => {
    console.log(err);
    return undefined;
  },
});

tusServer.on("POST_CREATE",
  async (req: ServerRequest, upload: Upload, url: string) => {
    console.log("upload create")
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const public_video_id = generatePublicId();
    await db.transaction(async (tx) => {
      const [ video_entry ] = await tx.insert(videos).values({ userId: user.id, publicId: public_video_id }).returning();
      await tx.insert(uploads).values({ userId: user.id, tusId: upload.id, tusInfo: upload, videoId: video_entry!.id, state: 'partially_uploaded' });
    });
  }
)

tusServer.on("POST_FINISH",
  async (req: ServerRequest, res: Response, tus_upload: Upload) => {
    console.log("upload done", tus_upload)
    const user = await requireAuth(req);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const [ upload_entry ] = await db.update(uploads).set({ state: 'completed' }).where(
      and(
        eq(uploads.tusId, tus_upload.id),
        eq(uploads.userId, user.id)
      )
    ).returning();
    if(!upload_entry) {
      console.error("upload entry not found after tus finished")
      return;
    }
    const [video_entry] = await db.select().from(videos).innerJoin(uploads, eq(videos.id, uploads.videoId)).where(
      and(
        eq(videos.userId, user.id),
        eq(uploads.id, upload_entry.id)
      )
    );
    if(!video_entry) {
      console.error("video entry not found after tus upload")
      return;
    }
    const job = await transcodeQueue.add(`transcode-${tus_upload.id}`, { tus_upload: tus_upload, upload_entry: upload_entry, video_entry: video_entry.videos });
  }
)

tusServer.on("POST_TERMINATE",
  async (req: ServerRequest, res: Response, id: string) => {
    console.log("upload aborted")
    await db.transaction(async (tx) => {
      const [ upload ] = await tx.select().from(uploads).where(eq(uploads.tusId, id));
      if(!upload) {
        console.error(`unable to delete upload, not found ${uploads.tusId} not found`);
        return;
      }
      await tx.delete(uploads).where(eq(uploads.tusId, id));
      await tx.delete(videos).where(eq(videos.id, upload.videoId));
    });
  }
)


tusServer.on("POST_RECEIVE", async (req: ServerRequest, upload: Upload) => {
  // console.log("upload recv")
  // await db.update(uploads).set({ state: 'partially_uploaded' }).where(eq(uploads.tusId, upload.id));
})

export async function tus_upload_auth_wrapper(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  if (!user) {
   return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if(req.method == "GET") {
    return Response.json({ error: "Access Forbidden" }, { status: 403 });
  }
  //console.log(req);
  const res = await tusServer.handleWeb(req);
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  return res;
}
