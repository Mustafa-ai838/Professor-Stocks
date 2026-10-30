const { createServer } = require("node:http");
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { existsSync, mkdirSync } = require("node:fs");
const { extname, join, resolve, sep } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const port = Number(process.env.PORT || 3001);
const databasePath = resolve(process.env.DB_PATH || join(__dirname, "data", "app.sqlite"));
const publicDirectory = resolve(__dirname, "public");
const isProduction = process.env.NODE_ENV === "production";
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const cookieName = "professor_stocks_session";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

mkdirSync(join(__dirname, "data"), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`);
database.exec("PRAGMA foreign_keys = ON");
database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

const findUserByEmail = database.prepare(
  "SELECT id, name, email, password_hash, password_salt FROM users WHERE email = ?",
);
const findSession = database.prepare(`
  SELECT users.id, users.name, users.email
  FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > ?
`);
const insertSession = database.prepare(
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
);
const deleteSession = database.prepare("DELETE FROM sessions WHERE token_hash = ?");

function sendJson(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 10_000) tooLarge = true;
    });
    request.on("end", () => {
      if (tooLarge) return rejectBody(new Error("Request body is too large."));
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(new Error("Please send valid JSON."));
      }
    });
    request.on("error", rejectBody);
  });
}

function readCookie(request) {
  const cookies = request.headers.cookie || "";
  const entry = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${cookieName}=`));
  return entry ? decodeURIComponent(entry.slice(cookieName.length + 1)) : null;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function startSession(response, userId) {
  const token = randomBytes(32).toString("base64url");
  insertSession.run(tokenHash(token), userId, Date.now() + sessionLifetime);
  const cookieParts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(sessionLifetime / 1000)}`,
  ];
  if (isProduction) cookieParts.push("Secure");
  response.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSession(response, request) {
  const token = readCookie(request);
  if (token) deleteSession.run(tokenHash(token));
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? "; Secure" : ""}`,
  );
}

function getUser(request) {
  const token = readCookie(request);
  if (!token || token.length > 100) return null;
  const user = findSession.get(tokenHash(token), Date.now());
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

function validEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordDigest(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/me") {
    return sendJson(response, 200, { user: getUser(request) });
  }

  if (request.method === "POST" && pathname === "/api/register") {
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;

    if (name.length < 2 || name.length > 80) {
      return sendJson(response, 400, { error: "Name must be between 2 and 80 characters." });
    }
    if (!validEmail(email)) {
      return sendJson(response, 400, { error: "Enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return sendJson(response, 400, { error: "Password must be between 8 and 128 characters." });
    }

    const salt = randomBytes(16).toString("hex");
    try {
      const result = database.prepare(`
        INSERT INTO users (name, email, password_hash, password_salt)
        VALUES (?, ?, ?, ?)
      `).run(name, email, passwordDigest(password, salt), salt);
      startSession(response, Number(result.lastInsertRowid));
      return sendJson(response, 201, { user: { name, email } });
    } catch (error) {
      if (error.errcode === 2067) {
        return sendJson(response, 409, { error: "An account with this email already exists." });
      }
      throw error;
    }
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    if (!validEmail(email) || typeof password !== "string" || password.length > 128) {
      return sendJson(response, 401, { error: "Invalid email or password." });
    }

    const user = findUserByEmail.get(email);
    const submittedHash = passwordDigest(password, user ? user.password_salt : "invalid-login-salt");
    const matches = user
      ? timingSafeEqual(Buffer.from(submittedHash, "hex"), Buffer.from(user.password_hash, "hex"))
      : false;
    if (!matches) return sendJson(response, 401, { error: "Invalid email or password." });

    clearSession(response, request);
    startSession(response, user.id);
    return sendJson(response, 200, { user: { name: user.name, email: user.email } });
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    clearSession(response, request);
    return sendJson(response, 200, { message: "You are signed out." });
  }

  return sendJson(response, 404, { error: "API route not found." });
}

function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end("Method not allowed.");
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request.");
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(`${publicDirectory}${sep}`) || !existsSync(filePath)) {
    response.writeHead(404);
    return response.end("Not found.");
  }

  const { readFile } = require("node:fs");
  readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(500);
      return response.end("Unable to load this page.");
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Length": content.length,
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  );

  const pathname = new URL(request.url, "http://localhost").pathname;
  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(request, response, pathname);
    } else {
      serveStatic(request, response, pathname);
    }
  } catch (error) {
    if (error.message === "Please send valid JSON.") {
      return sendJson(response, 400, { error: error.message });
    }
    if (error.message === "Request body is too large.") {
      return sendJson(response, 413, { error: error.message });
    }
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Something went wrong. Please try again." });
    else response.destroy();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Professor Stocks is running at http://localhost:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutDown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
