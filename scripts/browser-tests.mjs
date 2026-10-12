import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const port = 8099;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  "node",
  ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: "ignore", detached: true },
);

function stop() {
  if (!server.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/connect`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`test server did not answer on ${origin}`);
}

try {
  await ready();
  const test = spawn(
    "node",
    ["--experimental-strip-types", "--test", "--test-timeout", "120000", "src/lib/oauth/connect-browser.test.ts"],
    { cwd: root, stdio: "inherit", env: { ...process.env, CONNECT_TEST_ORIGIN: origin } },
  );
  const code = await new Promise((resolve) => test.on("exit", resolve));
  stop();
  process.exit(typeof code === "number" ? code : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exit(1);
}
