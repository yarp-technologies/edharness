import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lifetime = 10 * 60 * 1000;
const maxBody = 2048;

if (process.platform === "win32") {
  console.error("Native Windows is not supported because POSIX key permissions cannot be guaranteed. Use WSL.");
  process.exitCode = 1;
} else if (process.argv[2] === "--migrate" || process.argv[2] === "--migrate-previous") {
  const previous = process.argv[2] === "--migrate-previous";
  try {
    if (
      (previous && process.argv.length !== 3) ||
      (!previous && (process.argv.length !== 4 || !process.argv[3]))
    ) {
      console.error(
        previous ? "The previous-key migration takes no arguments." : "Specify the path to the existing key file after --migrate.",
      );
      process.exitCode = 1;
    } else {
      const source = previous ? path.join(configDirectory(), "opened", "loom-api-key") : process.argv[3];
      if (await migrate(source)) {
        console.log("The existing Opened key was copied to the current configuration location.");
      } else {
        console.error("The existing Opened key was not found.");
        process.exitCode = previous ? 2 : 1;
      }
    }
  } catch (error) {
    if (error.code === "EEXIST") console.error("An Opened key already exists and was not changed.");
    else console.error("Could not migrate the Opened key. Check the key and directory permissions.");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "--serve") {
  await serve();
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const timer = setTimeout(() => {
    child.kill();
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  }, 5000);
  child.once("message", (message) => {
    clearTimeout(timer);
    if (typeof message !== "string" || !message.startsWith("http://127.0.0.1:")) {
      console.error("Could not start the local initialization form.");
      process.exitCode = 1;
    } else {
      console.log(message);
    }
    child.disconnect();
    child.unref();
  });
  child.once("error", () => {
    clearTimeout(timer);
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    if (!child.connected || code === 0) return;
    clearTimeout(timer);
    console.error("Could not start the local initialization form.");
    process.exitCode = 1;
  });
}

async function serve() {
  const route = `/${randomBytes(32).toString("hex")}`;
  let busy = false;
  let closed = false;
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 500, "Could not save the key. Check local file permissions.");
      else response.end();
    });
  });
  server.requestTimeout = 30_000;
  const timer = setTimeout(() => server.close(), lifetime);

  function finish(response, text) {
    closed = true;
    reply(response, 200, text);
    clearTimeout(timer);
    server.close();
  }

  async function handle(request, response) {
    if (closed) {
      reply(response, 410, "Initialization has ended.");
      return;
    }
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== origin.slice("http://".length)) {
      reply(response, 403, "Request denied.");
      return;
    }
    if (request.url !== route && request.url !== `${route}/cancel`) {
      reply(response, 404, "Page not found.");
      return;
    }
    if (request.method === "GET" && request.url === route) {
      reply(response, 200, form(route));
      return;
    }
    if (request.method !== "POST" || request.headers.origin !== origin) {
      reply(response, 403, "Request denied.");
      return;
    }
    if (busy) {
      reply(response, 409, "Initialization is already in progress.");
      return;
    }
    if (request.url === `${route}/cancel`) {
      finish(response, "Initialization cancelled. You can close this page.");
      return;
    }
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/x-www-form-urlencoded") {
      reply(response, 400, "Unsupported form submission.");
      return;
    }
    busy = true;
    request.setTimeout(30_000, () => request.destroy());
    try {
      let size = 0;
      const parts = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBody) {
          reply(response, 413, "Form is too large.");
          return;
        }
        parts.push(chunk);
      }
      const fields = new URLSearchParams(Buffer.concat(parts).toString("utf8"));
      const values = fields.getAll("key");
      const key = values.length === 1 ? values[0].trim() : "";
      if (!/^loom_[A-Za-z0-9_-]{20,128}$/.test(key)) {
        reply(response, 400, "The key format is not recognized. Use your Opened API key.");
        return;
      }
      await save(key);
      finish(response, "The Opened key was saved. You can close this page.");
    } finally {
      busy = false;
    }
  }

  server.listen(0, "127.0.0.1", () => {
    process.send?.(`http://127.0.0.1:${server.address().port}${route}`);
  });
}

function reply(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    // `no-referrer` makes browsers send Origin: null on the form POST.
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(body);
}

function form(route) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Opened</title>
<style>
  :root {
    color-scheme: light;
    --background: #f1f1f6;
    --card: #ffffff;
    --foreground: #14141a;
    --muted-foreground: #6b6b79;
    --muted: #eeeef3;
    --border: #e9e9f0;
    --field-outline: #8a8a98;
    --action: #4f46e5;
    --action-hover: #3730a3;
    --action-foreground: #ffffff;
    --brand-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);
    --action-gradient: linear-gradient(135deg, #4f46e5, #7e22ce);
    --glow: rgb(79 70 229 / 8%);
    --shadow: 0 1px 2px rgb(20 20 26 / 6%), 0 30px 60px rgb(20 20 26 / 14%);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --background: oklch(0.172 0.006 66);
      --card: oklch(0.205 0.006 66);
      --foreground: oklch(0.965 0.004 80);
      --muted-foreground: oklch(0.75 0.008 80);
      --muted: oklch(0.242 0.007 66);
      --border: oklch(0.305 0.008 66);
      --field-outline: oklch(0.51 0.008 66);
      --action: oklch(0.72 0.15 275);
      --action-hover: oklch(0.8 0.13 275);
      --action-foreground: oklch(0.18 0.03 275);
      --brand-gradient: linear-gradient(135deg, oklch(0.78 0.15 275), oklch(0.68 0.16 300));
      --action-gradient: linear-gradient(135deg, oklch(0.8 0.15 275), oklch(0.68 0.18 300));
      --glow: oklch(0.72 0.15 275 / 12%);
      --shadow: 0 1px 2px rgb(0 0 0 / 12%), 0 30px 60px rgb(0 0 0 / 30%);
    }
  }
  * { box-sizing: border-box; }
  body {
    min-height: 100vh;
    min-height: 100dvh;
    margin: 0;
    padding: 2rem 1rem;
    display: grid;
    place-items: center;
    background: radial-gradient(ellipse 700px 500px at 100% 100%, var(--glow), transparent 60%), var(--background);
    color: var(--foreground);
    font: 1rem/1.5 Onest, ui-sans-serif, system-ui, sans-serif;
  }
  main {
    width: min(100%, 425px);
    padding: 2.5rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--card);
    box-shadow: var(--shadow);
  }
  .brand { display: flex; align-items: center; gap: .75rem; font-weight: 700; }
  .brand-mark {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border-radius: .75rem;
    background: var(--brand-gradient);
    color: var(--action-foreground);
  }
  .brand-mark svg { width: 1.3rem; height: 1.3rem; }
  h1 { margin: 2rem 0 .5rem; font-size: 1.5rem; line-height: 1.2; letter-spacing: -.02em; }
  p { margin: 0; }
  .intro { color: var(--muted-foreground); }
  .key-form { display: grid; gap: .5rem; margin-top: 1.75rem; }
  label { color: var(--muted-foreground); font-size: .875rem; font-weight: 500; }
  input {
    width: 100%;
    min-width: 0;
    height: 2.75rem;
    padding: 0 .75rem;
    border: 1px solid var(--field-outline);
    border-radius: .5rem;
    background: var(--muted);
    color: var(--foreground);
    font: inherit;
  }
  .hint { color: var(--muted-foreground); font-size: .8125rem; line-height: 1.5; }
  button, .button {
    display: inline-flex;
    min-height: 2.75rem;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: .5rem;
    padding: .625rem 1rem;
    border: 1px solid transparent;
    border-radius: .5rem;
    font: inherit;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  :focus-visible { outline: 2px solid var(--action); outline-offset: 3px; }
  .save { margin-top: .75rem; background: var(--action-gradient); color: var(--action-foreground); }
  .save:hover { background: var(--action-hover); }
  .create { margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
  .create-title { font-size: .9375rem; font-weight: 600; }
  .create .hint { margin-top: .25rem; }
  .create .button { margin-top: 1rem; border-color: var(--border); background: var(--card); color: var(--foreground); }
  .create .button:hover, .cancel:hover { background: var(--muted); }
  .create svg { width: 1rem; height: 1rem; }
  .cancel { margin-top: .5rem; background: transparent; color: var(--muted-foreground); }
  @media (max-width: 480px) { main { padding: 1.75rem 1.5rem; } }
</style>
</head>
<body>
<main>
  <div class="brand">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/><path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/>
        <circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>
      </svg>
    </span>
    <span>Opened</span>
  </div>
  <h1>Connect your agent</h1>
  <p class="intro">Add an Opened API key to connect your agent to your account.</p>
  <form class="key-form" method="post" action="${route}" autocomplete="off">
    <label for="key">Opened API key</label>
    <input id="key" name="key" type="password" autocomplete="off" aria-describedby="key-help" required autofocus>
    <p class="hint" id="key-help">The key stays where the agent runs. Never paste it in chat. Saving replaces a previously saved key.</p>
    <button class="save" type="submit">Save key</button>
  </form>
  <section class="create" aria-labelledby="create-title">
    <p class="create-title" id="create-title">Need an API key?</p>
    <p class="hint">In your Opened profile, select API keys to create one.</p>
    <a class="button" href="https://demo.opened.site/app/profile" target="_blank" rel="noopener noreferrer" aria-label="Create an API key in your Opened profile (opens in a new tab)">
      Create an API key
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
    </a>
  </section>
  <form method="post" action="${route}/cancel"><button class="cancel" type="submit">Cancel</button></form>
</main>
</body>
</html>`;
}

async function migrate(source) {
  let file;
  try {
    file = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let key;
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 133 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error("The legacy key is not private.");
    }
    key = (await file.readFile("utf8")).trim();
    if (!/^loom_[A-Za-z0-9_-]{20,128}$/.test(key)) throw new Error("The legacy key format is not recognized.");
  } finally {
    await file.close();
  }
  await save(key, false);
  return true;
}

function configDirectory() {
  const configured = process.env.XDG_CONFIG_HOME || "";
  return path.isAbsolute(configured) ? configured : path.join(os.homedir(), ".config");
}

async function save(key, replace = true) {
  const directory = path.join(configDirectory(), "opened");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) {
    throw new Error("The key directory is not private.");
  }
  const temporary = path.join(directory, `.opened-key-${randomBytes(16).toString("hex")}`);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(key, "utf8");
      await file.chmod(0o600);
    } finally {
      await file.close();
    }
    const target = path.join(directory, "api-key");
    if (replace) await rename(temporary, target);
    else await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
