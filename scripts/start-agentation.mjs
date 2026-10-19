// Запускает локальный сервер Agentation (http://localhost:4747) перед `next dev`,
// чтобы заметки из тулбара сразу попадали к агенту через MCP.
// Сервер общий для всех локальных проектов и хранит заметки в ~/.agentation,
// поэтому он остаётся работать в фоне после остановки dev-сервера.
import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.AGENTATION_PORT || 4747);

function isListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

if (await isListening()) {
  console.log(`[agentation] server already running on http://localhost:${port}`);
} else {
  const child = spawn(`npx -y agentation-mcp server --port ${port}`, {
    detached: true,
    shell: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  console.log(`[agentation] starting server on http://localhost:${port}`);
}
