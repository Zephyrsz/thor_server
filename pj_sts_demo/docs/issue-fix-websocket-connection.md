# Issue Fix: Remote UI WebSocket Connection Failed

Date: 2026-07-07

## Summary

The remote UI at `https://thor:8003` showed:

```text
Connection issue
WebSocket connection failed.
```

The issue was fixed by making the browser WebSocket URL resolve from the current page origin instead of relying on a fixed host value from `ui.env`.

## Impact

- The UI page could load over HTTPS.
- Browser microphone access was available after accepting the self-signed certificate.
- The UI failed when opening the realtime WebSocket connection.
- The remote backend WSS service itself was healthy.

## Root Cause

The remote UI config had previously been modified to use a localhost WebSocket URL:

```text
REALTIME_WS_URL=wss://localhost:8003/v1/realtime
```

When the page is opened from Chrome on the MacBook, `localhost` points to the MacBook, not the thor server. As a result, the browser attempted to open the WebSocket against the wrong machine.

There was also a cache/stale-state risk because the Next.js page could keep previously loaded client JavaScript in the current browser tab.

## Fix

### Frontend URL Normalization

Updated `frontend/app/page.jsx` so the browser computes the realtime WebSocket URL from the current page origin:

```text
https://thor:8003 -> wss://thor:8003/v1/realtime
```

The UI now normalizes these values to same-origin WSS before connecting:

- empty value
- `auto`
- `same-origin`
- same-port `/v1/realtime` proxy URLs
- `localhost` URLs when the page is not opened from localhost

This prevents a remote browser session from accidentally connecting to the user's local machine.

### Disable UI Response Cache

Updated `frontend/server.mjs` to send:

```text
Cache-Control: no-store, max-age=0
```

This reduces the chance that Chrome keeps an older UI bundle after frontend deployment.

### Remote UI Runtime Config

The remote config is now:

```text
HOST=0.0.0.0
PORT=8003
REALTIME_WS_URL=auto
BACKEND_WS_URL=wss://localhost:8765/v1/realtime
BACKEND_TLS_REJECT_UNAUTHORIZED=0
HTTPS_AUTO_CERTS=1
HTTPS_CERT_FILE=/home/ubuntu/pj_sts_demo/frontend/certs/thor-ui.crt
HTTPS_KEY_FILE=/home/ubuntu/pj_sts_demo/frontend/certs/thor-ui.key
LOG_FILE=/home/ubuntu/pj_sts_demo/frontend/logs/ui.log
PID_FILE=/home/ubuntu/pj_sts_demo/frontend/ui.pid
SCREEN_SESSION=pj_sts_demo_ui
```

`REALTIME_WS_URL=auto` is intentional. It lets the UI derive the browser-facing WebSocket endpoint from the page URL.

The backend proxy target remains local to the thor server:

```text
wss://localhost:8765/v1/realtime
```

## Verification

Remote UI status:

```text
UI running on https://0.0.0.0:8003
Realtime websocket: auto
```

Remote listeners:

```text
0.0.0.0:8003      frontend HTTPS UI
0.0.0.0:8765      remote WSS backend proxy
127.0.0.1:8766    private backend websocket service
```

Config endpoint:

```text
https://thor:8003/api/config
{"realtimeWsUrl":"auto"}
```

WebSocket smoke test from local:

```text
wss://thor:8003/v1/realtime -> websocket open OK
```

## Browser Note

If Chrome already has an old tab open, close that tab and open a fresh tab:

```text
https://thor:8003
```

An already-loaded React page can keep old JavaScript and old state in memory until the tab is reloaded or reopened.

## Files Changed

- `frontend/app/page.jsx`
- `frontend/server.mjs`

## Operational Guidance

- Keep `REALTIME_WS_URL=auto` for the remote frontend.
- Keep `BACKEND_WS_URL=wss://localhost:8765/v1/realtime` so the UI server proxies to the thor-local WSS backend.
- Keep `BACKEND_TLS_REJECT_UNAUTHORIZED=0` while the backend WSS certificate is self-signed.
- Avoid using `localhost` for browser-facing WebSocket URLs unless the page itself is opened from localhost.
