import { requireAuth } from './auth';
import { mkdir, exists } from 'node:fs/promises';
import { join } from 'node:path';
import { Server, Upload } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { db, /*createUpload, deleteUpload, deleteUploadByTusId, updateUploadState*/ } from './orm';
import type { ServerRequest } from 'srvx';
import { uploads, videos } from './drizzle/schema';
import { and, eq, ne } from 'drizzle-orm';
import { transcodeQueue } from './transcode';

const tusServer = new Server({
  path: "/files",
  respectForwardedHeaders: true,
  postReceiveInterval: 10000,
  datastore: new FileStore({
    directory: "./data/uploads",
    expirationPeriodInMilliseconds: 24*3600*1000*7
  }),

  onResponseError: async (req, err) => {
    console.log(err);
    return undefined;
  },
});

tusServer.on("POST_FINISH", async (req: ServerRequest, res: Response, tus_upload: Upload) => {
  console.log("upload done", tus_upload)
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const upload_entry = await db.update(uploads).set({ state: 'completed' }).where(
    and(
      eq(uploads.tusId, tus_upload.id),
      eq(uploads.userId, user.id)
    )
  ).returning();
  const video_entry = await db.select(videos).from(videos).innerJoin(uploads, eq(videos.id, uploads.videoId)).where(
    and(
      eq(videos.userId, user.id),
      eq(uploads.id, upload_entry[0].id)
    )
  );
  const job = await transcodeQueue.add(`transcode-${tus_upload.id}`, { tus_upload: tus_upload, upload_entry: upload_entry[0], video_entry: video_entry[0] });
})

tusServer.on("POST_CREATE", async (req: ServerRequest, upload: Upload, url: string) => {
  console.log("upload create")
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const video_entry = await db.insert(videos).values({ userId: user.id }).returning();
  await db.insert(uploads).values({ userId: user.id, tusId: upload.id, tusInfo: upload, videoId: video_entry[0]?.id })
})

tusServer.on("POST_RECEIVE", async (req: ServerRequest, upload: Upload) => {
  console.log("upload recv")
  await db.update(uploads).set({ state: 'partially_uploaded' }).where(eq(uploads.tusId, upload.id));
})

tusServer.on("POST_TERMINATE", async (req: ServerRequest, res: Response, id: string) => {
  console.log("upload aborted")
  await db.transaction(async (tx) => {
    const upload = await tx.select().from(uploads).where(eq(uploads.tusId, id));
    await tx.delete(uploads).where(eq(uploads.tusId, id));
    await tx.delete(videos).where(eq(videos.id, upload[0]?.videoId));
  });
})


export async function tus_upload_auth_wrapper(req: Request): Promise<Response> {
  //const user = await requireAuth(req);
  //if (!user) {
  //  return Response.json({ error: "Authentication required" }, { status: 401 });
  //}
  if(req.method == "GET") {
    return Response.json({ error: "Access Forbidden" }, { status: 403 });
  }
  const res = await tusServer.handleWeb(req);
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  return res;
}

export async function getOpenUploads(req: Request) {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const my_uploads = await db.select().from(uploads).where(
    and(
      eq(uploads.userId, user.id),
      ne(uploads.state, 'completed')
    )
  );
  return Response.json(my_uploads);
}

export async function getVideoForUpload(req: Request) {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const tus_id = req.params.tus_id;
  const my_videos = await db.select(videos).from(videos).innerJoin(uploads, eq(videos.id, uploads.videoId)).where(
    and(
      eq(uploads.userId, user.id),
      eq(uploads.tusId, tus_id)
    )
  );
  return Response.json(my_videos[0]);
}