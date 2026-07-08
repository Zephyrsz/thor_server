# Speech-to-Speech Frontend

This module contains the Next.js browser UI for the Hugging Face `speech-to-speech` realtime websocket backend.

Start it from this `frontend` directory with:

```bash
REALTIME_WS_URL=wss://thor:8765/v1/realtime ./start_ui.sh start
```

`REALTIME_WS_URL` is the single remote realtime service configuration used by the UI.
The browser connects to the UI origin at `/v1/realtime`; the UI service proxies that websocket to `REALTIME_WS_URL`.
This avoids browser failures when the backend WSS certificate is private or self-signed.

Browser microphone access requires the UI page itself to be opened from `https://...` or `localhost`.
The websocket URL being `wss://...` is not enough.

To serve the UI directly over HTTPS, pass a trusted certificate and key:

```bash
REALTIME_WS_URL=wss://192.168.3.11:8765/v1/realtime \
HTTPS_CERT_FILE=/etc/letsencrypt/live/your-host/fullchain.pem \
HTTPS_KEY_FILE=/etc/letsencrypt/live/your-host/privkey.pem \
BACKEND_TLS_REJECT_UNAUTHORIZED=0 \
./start_ui.sh start
```

Then open `https://your-host:8003`.

Service commands:

```bash
./start_ui.sh start
./start_ui.sh stop
./start_ui.sh restart
./start_ui.sh status
```

By default the UI listens on `0.0.0.0:8003`, writes logs to `logs/ui.log`, and stores its pid in `ui.pid`.
