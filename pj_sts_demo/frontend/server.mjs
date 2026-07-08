import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import net from "node:net";
import tls from "node:tls";
import next from "next";

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "8003", 10);
const certFile = process.env.HTTPS_CERT_FILE || "";
const keyFile = process.env.HTTPS_KEY_FILE || "";
const realtimeWsUrl = process.env.REALTIME_WS_URL || "";
const backendWsUrl = process.env.BACKEND_WS_URL || "";
const backendTlsRejectUnauthorized = process.env.BACKEND_TLS_REJECT_UNAUTHORIZED !== "0";
const useHttps = Boolean(certFile && keyFile);
const realtimeProxyUrl = backendWsUrl || realtimeWsUrl;

if (certFile || keyFile) {
  if (!certFile || !keyFile) {
    throw new Error("Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE to serve the UI over HTTPS.");
  }
  if (!existsSync(certFile)) {
    throw new Error(`HTTPS certificate file does not exist: ${certFile}`);
  }
  if (!existsSync(keyFile)) {
    throw new Error(`HTTPS key file does not exist: ${keyFile}`);
  }
}

const app = next({ dev: false, hostname: host, port });
const handle = app.getRequestHandler();
const backendWsTarget = realtimeProxyUrl ? new URL(realtimeProxyUrl) : null;

await app.prepare();

function handleNoStore(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  return handle(request, response);
}

const server = useHttps
  ? createHttpsServer(
      {
        cert: readFileSync(certFile),
        key: readFileSync(keyFile),
      },
      handleNoStore
    )
  : createHttpServer(handleNoStore);

function writeBadGateway(socket) {
  if (!socket.destroyed) {
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  }
}

server.on("upgrade", (request, socket, head) => {
  if (!backendWsTarget || !request.url?.startsWith("/v1/realtime")) {
    socket.destroy();
    return;
  }

  const targetPort =
    backendWsTarget.port || (backendWsTarget.protocol === "wss:" ? "443" : "80");
  const connect =
    backendWsTarget.protocol === "wss:"
      ? tls.connect({
          host: backendWsTarget.hostname,
          port: Number(targetPort),
          servername: backendWsTarget.hostname,
          rejectUnauthorized: backendTlsRejectUnauthorized,
        })
      : net.connect({ host: backendWsTarget.hostname, port: Number(targetPort) });

  connect.once(backendWsTarget.protocol === "wss:" ? "secureConnect" : "connect", () => {
    const targetPath = `${backendWsTarget.pathname}${backendWsTarget.search}`;
    const headers = [];
    let sawHost = false;

    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (name.toLowerCase() === "host") {
        sawHost = true;
        headers.push(`Host: ${backendWsTarget.host}`);
      } else {
        headers.push(`${name}: ${value}`);
      }
    }

    if (!sawHost) {
      headers.push(`Host: ${backendWsTarget.host}`);
    }

    connect.write(`${request.method} ${targetPath} HTTP/${request.httpVersion}\r\n`);
    connect.write(`${headers.join("\r\n")}\r\n\r\n`);

    if (head.length) {
      connect.write(head);
    }

    socket.pipe(connect).pipe(socket);
  });

  connect.once("error", (error) => {
    console.error(`Realtime websocket proxy failed: ${error.message}`);
    writeBadGateway(socket);
  });

  socket.once("error", () => {
    connect.destroy();
  });
});

server.listen(port, host, () => {
  const protocol = useHttps ? "https" : "http";
  console.log(`UI ready on ${protocol}://${host}:${port}`);
  console.log(`Realtime websocket: ${realtimeWsUrl}`);
  if (backendWsTarget) {
    console.log(`Realtime proxy target: ${backendWsTarget.toString()}`);
    console.log(
      `Backend TLS verification: ${backendTlsRejectUnauthorized ? "enabled" : "disabled"}`
    );
  }
});
