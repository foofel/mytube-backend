import { serve } from 'bun';
import './src/orm';
import { authCheck, authLogin, authLogout, requireAuth } from './src/auth';
import { tus_upload_auth_wrapper } from './src/tus';
import { getVideoInfoForVideoPage, getLandingPageVideos, addVideoDislike, addVideoView, addVideoLike, removeVideoDislike, removeVideoLike } from './src/videos';
import CORS from "bun-routes-cors";
import { searchTags } from './src/tags';
import { deleteVideo, getOwnVideos, getVideo, getVideoByTusID, removeVideoTags, setVideoTags, updateVideo } from './src/admin';

const PORT = parseInt(process.env.PORT || "8080");

serve({
  port: PORT,
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  routes: CORS({
    // Authentication routes
    "/api/auth/login": {
      POST: authLogin,
    },
    "/api/auth/logout": {
      POST: authLogout,
    },
    "/api/auth/check": {
      GET: authCheck,
    },

    // public video routes
    "/api/videos": {
      GET: getLandingPageVideos
    },
    "/api/video/:public_id": {
      GET: getVideoInfoForVideoPage
    },
    "/api/video/:public_id/like": {
      POST: addVideoLike,
      DELETE: removeVideoLike
    },
    "/api/video/:public_id/dislike": {
      POST: addVideoDislike,
      DELETE: removeVideoDislike,
    },
    "/api/video/:public_id/views": {
      POST: addVideoView,
    },

    // Video management routes
    "/api/video/admin/:public_id": {
      GET: getVideo,
      PATCH: updateVideo,
      DELETE: deleteVideo,
    },
    "/api/video/admin/tus/:tus_id": {
      GET: getVideoByTusID
    },
    "/api/video/admin/own": {
      GET: getOwnVideos,
    },
    "/api/video/:public_id/tags": {
      POST: setVideoTags,
      DELETE: removeVideoTags
    },
    "/api/tags/suggest": {
      POST: searchTags
    },

    // TUS and relates routes
    '/files/*': tus_upload_auth_wrapper,

    // Catch-all for unmatched API routes
    "/api/*": Response.json({ message: "API endpoint not found" }, { status: 404 }),
  }, {    // optional: set your custom headers, these are the default values:
        //origin: "*",  // 'yoursite.com'
        //methods: "*", // 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'
        //headers: "*" // 'Content-Type', 'Authorization'
  }),
  async fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`MyTube Backend listening on http://0.0.0.0:${PORT}`);