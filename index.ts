import { serve } from 'bun';
import './src/orm'; // Initialize database

// Import route handlers
import { authCheck, authLogin, authLogout, requireAuth } from './src/auth';
import { getOpenUploads, getVideoForUpload, tus_upload_auth_wrapper } from './src/tus';
import { getVideoEntry, getVideos, updateVideoEntry } from './src/videos';

const PORT = parseInt(process.env.PORT || "6989");


import CORS from "bun-routes-cors";

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
      GET: getVideos
    },
    "/api/video/:id": {
      GET: getVideoEntry
    },
    "/api/video/:id/like": {
      POST: (a) => new Response("OK"),
    },
    "/api/video/:id/dislike": {
      POST: (a) => new Response("OK"),
    },
    "/api/video/:id/add_view": {
      POST: (a) => new Response("OK"),
    },

    // Video management routes
    "/api/video/admin/:id": {
      GET: getVideoEntry,
      PATCH: updateVideoEntry,
    },
    "/api/video/admin/tus/:tus_id": {
      GET: getVideoForUpload
    },

    // TUS and relates routes
    '/files/*': tus_upload_auth_wrapper,
    "/api/uploads": {
      GET: getOpenUploads,
    },

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

console.log(`MyTube Backend listening on http://localhost:${PORT}`);