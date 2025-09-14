import { RedisClient } from "bun";
import { getUserByUsername as dbGetUserByUsername, getUserById as dbGetUserById, getPasswordHash as dbGetPasswordHash } from './orm';

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || "6379";

const redis_client = new RedisClient(`redis://${REDIS_HOST}:${REDIS_PORT}`);

interface User {
  id: number;
  name: string;
  profile_image_path?: string;
}

interface SessionData {
  userId: number;
  username: string;
  createdAt: string;
}

const COOKIE_NAME = "mytube_session";
const SESSION_EXPIRY = 60 * 60 * 24 * 7; // 7 days in seconds

function generateSessionId(): string {
  return crypto.randomUUID();
}

async function hashPassword(password: string): Promise<string> {
  const key = await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65535,
    timeCost: 2
  });
  return key
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return await Bun.password.verify(password, storedHash, "argon2id");
}

export async function createSession(userId: number, username: string): Promise<string> {
  const sessionId = generateSessionId();
  const sessionData: SessionData = {
    userId,
    username,
    createdAt: new Date().toISOString(),
  };

  const sessionDataString = JSON.stringify(sessionData);
  await redis_client.set(`session:${sessionId}`, sessionDataString);
  await redis_client.expire(`session:${sessionId}`, SESSION_EXPIRY);
  return sessionId;
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  const data = await redis_client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function destroySession(sessionId: string): Promise<void> {
  await redis_client.del(`session:${sessionId}`);
}

export function getSessionCookie(req: Request): string | null {
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;

  const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? (match[1] ?? null) : null;
}

export function setSessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_EXPIRY}; Path=/`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export async function login(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return Response.json({ error: "Username and password required" }, { status: 400 });
    }

    // Query user from database (you'll need to implement database connection)
    // For now, this is a placeholder - replace with actual database query
    const user = await getUserByUsername(username);
    if (!user) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const passwordHash = await getPasswordHash(user.id);
    if (!passwordHash || !await verifyPassword(password, passwordHash)) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const sessionId = await createSession(user.id, user.name);

    return Response.json(
      { success: true, user: { id: user.id, name: user.name } },
      {
        status: 200,
        headers: { "Set-Cookie": setSessionCookie(sessionId) }
      }
    );
  } catch (error) {
    console.error("Login error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function logout(req: Request): Promise<Response> {
  const sessionId = getSessionCookie(req);

  if (sessionId) {
    await destroySession(sessionId);
  }

  return Response.json(
    { success: true },
    {
      status: 200,
      headers: { "Set-Cookie": clearSessionCookie() }
    }
  );
}

export async function requireAuth(req: Request): Promise<User | null> {
  const sessionId = getSessionCookie(req);
  if (!sessionId) return null;

  const session = await getSession(sessionId);
  if (!session) return null;

  // Get full user data from database
  return await getUserById(session.userId);
}

// Database helper functions
async function getUserByUsername(username: string): Promise<User | null> {
  return await dbGetUserByUsername(username);
}

async function getUserById(id: number): Promise<User | null> {
  return await dbGetUserById(id);
}

async function getPasswordHash(userId: number): Promise<string | null> {
  return await dbGetPasswordHash(userId);
}