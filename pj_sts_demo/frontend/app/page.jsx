"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CircleStop,
  Headphones,
  Mic,
  Radio,
  RefreshCcw,
  Server,
  Trash2,
  Volume2,
  Waves,
} from "lucide-react";
import {
  DEFAULT_WS_URL,
  PcmPlayer,
  TARGET_SAMPLE_RATE,
  audioStatsFromBase64,
  createPcm16WavUrl,
  nowLabel,
  startMicCapture,
} from "../lib/voice";

const STORAGE_KEY = "realtime-voice-console";
const CONFIG_URL = "/api/config";

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Button({ kind = "secondary", icon: Icon, children, type = "button", ...props }) {
  return (
    <button className={`button button-${kind}`} type={type} {...props}>
      {Icon ? <Icon size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

function splitTranscriptItems(text) {
  return text
    .split(/\n{2,}/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.0s";
  return `${seconds.toFixed(1)}s`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getSameOriginRealtimeWsUrl() {
  if (typeof window === "undefined") return DEFAULT_WS_URL;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/v1/realtime`;
}

function normalizeRealtimeWsUrl(value) {
  const sameOriginUrl = getSameOriginRealtimeWsUrl();
  const candidate = String(value || "").trim();

  if (!candidate || candidate === "auto" || candidate === "same-origin") {
    return sameOriginUrl;
  }

  try {
    const parsed = new URL(candidate, window.location.href);
    const pagePort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    const targetPort = parsed.port || (parsed.protocol === "wss:" ? "443" : "80");
    const isRealtimeProxy = parsed.pathname === "/v1/realtime" && targetPort === pagePort;

    if (isRealtimeProxy) {
      return sameOriginUrl;
    }

    if (isLocalhost(parsed.hostname) && !isLocalhost(window.location.hostname)) {
      return sameOriginUrl;
    }

    return parsed.toString();
  } catch {
    return sameOriginUrl;
  }
}

async function getRuntimeDefaultWsUrl() {
  try {
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!response.ok) return getSameOriginRealtimeWsUrl();

    const config = await response.json();
    return normalizeRealtimeWsUrl(config.realtimeWsUrl);
  } catch {
    return getSameOriginRealtimeWsUrl();
  }
}

export default function Page() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_WS_URL);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [instructions, setInstructions] = useState(
    "You are a concise, helpful voice assistant. Keep replies natural and brief unless the user asks for detail."
  );
  const [socketState, setSocketState] = useState("disconnected");
  const [micState, setMicState] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [liveUser, setLiveUser] = useState("");
  const [liveAssistant, setLiveAssistant] = useState("");
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [outputAudio, setOutputAudio] = useState({
    chunks: 0,
    bytes: 0,
    samples: 0,
    level: 0,
    peak: 0,
    active: false,
    lastUpdated: "",
    url: "",
  });
  const [sessionLabel, setSessionLabel] = useState("not connected");
  const [connectionNote, setConnectionNote] = useState("Connect to the remote server, then start the browser microphone.");
  const [localAudio, setLocalAudio] = useState({
    inputLabel: "Browser microphone",
    outputLabel: "Browser speakers",
    secureContext: true,
    available: true,
  });

  const socketRef = useRef(null);
  const micRef = useRef(null);
  const playerRef = useRef(null);
  const liveUserRef = useRef("");
  const outputAudioRef = useRef(outputAudio);
  const assistantTranscriptRef = useRef("");
  const assistantHistoryPushedRef = useRef(false);
  const assistantAudioChunksRef = useRef([]);
  const audioUrlsRef = useRef([]);

  useEffect(() => {
    let active = true;

    async function loadSavedSettings() {
      const runtimeDefaultWsUrl = await getRuntimeDefaultWsUrl();
      if (!active) return;

      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setServerUrl(runtimeDefaultWsUrl);
        setSettingsLoaded(true);
        return;
      }

      try {
        const parsed = JSON.parse(stored);
        setServerUrl(runtimeDefaultWsUrl);
        if (parsed.instructions) setInstructions(parsed.instructions);
      } catch {
        // Ignore stale local state.
        setServerUrl(runtimeDefaultWsUrl);
      }

      setSettingsLoaded(true);
    }

    loadSavedSettings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ instructions }));
  }, [instructions, settingsLoaded]);

  useEffect(() => {
    setLocalAudio((current) => ({
      ...current,
      secureContext: window.isSecureContext || isLocalhost(window.location.hostname),
      available: Boolean(navigator.mediaDevices?.getUserMedia),
    }));
  }, []);

  useEffect(
    () => () => {
      micRef.current?.stop?.();
      socketRef.current?.close?.();
      playerRef.current?.close?.();
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const statusTone = useMemo(() => {
    if (socketState === "connected") return "good";
    if (socketState === "connecting" || micState === "connecting") return "warn";
    if (socketState === "error" || micState === "error") return "bad";
    return "neutral";
  }, [socketState, micState]);

  const outputDuration = outputAudio.samples / TARGET_SAMPLE_RATE;

  function setOutputAudioState(updater) {
    setOutputAudio((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      outputAudioRef.current = next;
      return next;
    });
  }

  function resetOutputAudio(active = false) {
    setOutputAudioState({
      chunks: 0,
      bytes: 0,
      samples: 0,
      level: 0,
      peak: 0,
      active,
      lastUpdated: "",
      url: "",
    });
  }

  function createAssistantAudioUrl() {
    if (!assistantAudioChunksRef.current.length) return "";
    const url = createPcm16WavUrl(assistantAudioChunksRef.current, TARGET_SAMPLE_RATE);
    audioUrlsRef.current.push(url);
    return url;
  }

  async function refreshLocalAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const input = devices.find((device) => device.kind === "audioinput" && device.label);
      const output = devices.find((device) => device.kind === "audiooutput" && device.label);

      setLocalAudio((current) => ({
        ...current,
        inputLabel: input?.label || current.inputLabel || "Browser microphone",
        outputLabel: output?.label || current.outputLabel || "Browser speakers",
      }));
    } catch {
      // Device labels are best-effort and depend on browser permission state.
    }
  }

  function pushEvent(type, detail) {
    setEvents((current) => [
      { id: makeId("event"), type, detail, time: nowLabel() },
      ...current,
    ].slice(0, 40));
  }

  function pushHistory(role, text, meta = {}) {
    if (!text.trim()) return;
    setHistory((current) => [
      {
        id: makeId("turn"),
        role,
        text: text.trim(),
        time: nowLabel(),
        ...meta,
      },
      ...current,
    ]);
  }

  function ensurePlayer() {
    if (!playerRef.current) {
      playerRef.current = new PcmPlayer({ sampleRate: TARGET_SAMPLE_RATE });
    }
    return playerRef.current;
  }

  function send(event) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }

  async function connect() {
    setError("");
    setSocketState("connecting");
    setConnectionNote("Opening websocket connection.");

    socketRef.current?.close?.();
    const targetUrl = normalizeRealtimeWsUrl(serverUrl);
    if (targetUrl !== serverUrl) {
      setServerUrl(targetUrl);
    }

    const socket = new WebSocket(targetUrl);
    socketRef.current = socket;

    return await new Promise((resolve, reject) => {
      let settled = false;

      socket.onopen = async () => {
        if (socketRef.current !== socket) return;
        settled = true;
        setSocketState("connected");
        setConnectionNote("Connected. Use this browser for local speech input and output.");
        setSessionLabel("session active");
        pushEvent("socket.open", targetUrl);
        ensurePlayer();
        await playerRef.current?.resume?.();
        send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions,
          },
        });
        resolve(socket);
      };

      socket.onmessage = async (message) => {
        if (socketRef.current !== socket) return;
        let event;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }

        pushEvent(event.type, event.event_id ?? "");

        switch (event.type) {
          case "session.created":
            setSessionLabel("session ready");
            break;
          case "input_audio_buffer.speech_started":
            setLiveAssistant("");
            setAssistantSpeaking(false);
            resetOutputAudio(false);
            setMicState("listening");
            break;
          case "conversation.item.input_audio_transcription.delta":
            setLiveUser((current) => {
              const next = `${current}${event.delta ?? ""}`;
              liveUserRef.current = next;
              return next;
            });
            break;
          case "conversation.item.input_audio_transcription.completed": {
            const transcript = event.transcript ?? "";
            const text = transcript || liveUserRef.current;
            pushHistory("user", text, { kind: "transcript" });
            setLiveUser("");
            liveUserRef.current = "";
            break;
          }
          case "response.created":
            setAssistantSpeaking(true);
            setLiveAssistant("");
            assistantTranscriptRef.current = "";
            assistantHistoryPushedRef.current = false;
            assistantAudioChunksRef.current = [];
            resetOutputAudio(true);
            break;
          case "response.audio_transcript.done":
          case "response.output_audio_transcript.done": {
            const transcript = event.transcript ?? "";
            setLiveAssistant(transcript);
            assistantTranscriptRef.current = transcript;
            break;
          }
          case "response.audio.delta":
          case "response.output_audio.delta": {
            const stats = audioStatsFromBase64(event.delta ?? "");
            setAssistantSpeaking(true);
            if (event.delta) {
              assistantAudioChunksRef.current.push(event.delta);
            }
            setOutputAudioState((current) => ({
              ...current,
              chunks: current.chunks + 1,
              bytes: current.bytes + stats.bytes,
              samples: current.samples + stats.samples,
              level: Math.min(1, stats.rms * 6),
              peak: Math.max(current.peak, stats.peak),
              active: true,
              lastUpdated: nowLabel(),
            }));
            await playerRef.current?.enqueue?.(event.delta ?? "");
            break;
          }
          case "response.audio.done":
          case "response.output_audio.done":
            setAssistantSpeaking(false);
            const completedAudioUrl = outputAudioRef.current.url || createAssistantAudioUrl();
            setOutputAudioState((current) => ({
              ...current,
              active: false,
              level: 0,
              url: completedAudioUrl,
            }));
            break;
          case "response.done": {
            setAssistantSpeaking(false);
            const audioUrl = outputAudioRef.current.url || createAssistantAudioUrl();
            setOutputAudioState((current) => ({ ...current, active: false, level: 0, url: audioUrl }));
            if (!assistantHistoryPushedRef.current) {
              const audio = { ...outputAudioRef.current, url: audioUrl };
              const transcript = assistantTranscriptRef.current || (audio.chunks ? "Assistant speech audio received." : "");
              pushHistory("assistant", transcript, {
                kind: audio.chunks ? "speech response" : "response",
                audioChunks: audio.chunks,
                audioDuration: audio.samples / TARGET_SAMPLE_RATE,
                audioUrl,
              });
              assistantHistoryPushedRef.current = true;
            }
            break;
          }
          case "error":
            setSocketState("error");
            setError(event.error?.message || event.message || "The server returned an error.");
            break;
          default:
            break;
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setSocketState("error");
        setError("WebSocket connection failed.");
        setConnectionNote("Connection failed.");
        if (!settled) reject(new Error("WebSocket connection failed."));
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setSocketState("disconnected");
        setMicState("idle");
        setAssistantSpeaking(false);
        setConnectionNote("Disconnected.");
        pushEvent("socket.close", targetUrl);
        socketRef.current = null;
        if (!settled) reject(new Error("WebSocket connection closed before opening."));
      };
    });
  }

  function disconnect() {
    micRef.current?.stop?.();
    micRef.current = null;
    playerRef.current?.reset?.();
    socketRef.current?.close?.();
    socketRef.current = null;
    setSocketState("disconnected");
    setSessionLabel("not connected");
    setMicState("idle");
    setMicLevel(0);
    setAssistantSpeaking(false);
    setLiveUser("");
    setLiveAssistant("");
    assistantTranscriptRef.current = "";
    assistantHistoryPushedRef.current = false;
    assistantAudioChunksRef.current = [];
    resetOutputAudio(false);
    setConnectionNote("Disconnected.");
  }

  async function startMic() {
    setError("");
    try {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        await connect();
      }
    } catch (nextError) {
      setMicState("error");
      setError(nextError instanceof Error ? nextError.message : "Could not connect to the websocket.");
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Connect to the websocket before starting the microphone.");
      return;
    }

    if (micRef.current) return;

    setMicState("connecting");
    try {
      micRef.current = await startMicCapture({
        onChunk: (audio) => {
          send({ type: "input_audio_buffer.append", audio });
        },
        onLevel: setMicLevel,
      });
      await refreshLocalAudioDevices();
      setMicState("live");
      setConnectionNote("Browser microphone is streaming to the remote model.");
      pushEvent("mic.start", "capturing");
    } catch (nextError) {
      setMicState("error");
      setError(nextError instanceof Error ? nextError.message : "Could not start the microphone.");
    }
  }

  function stopMic() {
    micRef.current?.stop?.();
    micRef.current = null;
    setMicState("idle");
    setMicLevel(0);
    pushEvent("mic.stop", "stopped");
    setConnectionNote("Microphone stopped.");
  }

  function clearConversation() {
    setHistory([]);
    setEvents([]);
    setLiveUser("");
    setLiveAssistant("");
    liveUserRef.current = "";
    assistantTranscriptRef.current = "";
    assistantHistoryPushedRef.current = false;
    assistantAudioChunksRef.current = [];
    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioUrlsRef.current = [];
    resetOutputAudio(false);
    setError("");
    pushEvent("history.clear", "cleared");
  }

  const liveBlocks = splitTranscriptItems(liveUser || liveAssistant);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Realtime Voice Console</p>
          <h1>Browser voice UI for the speech-to-speech server.</h1>
        </div>
        <div className="topbar-status">
          <Badge tone={statusTone}>{socketState}</Badge>
          <span className="status-copy">{connectionNote}</span>
        </div>
      </header>

      <section className="hero-strip">
        <div className="hero-metric">
          <span>Endpoint</span>
          <strong>{serverUrl}</strong>
        </div>
        <div className="hero-metric">
          <span>Session</span>
          <strong>{sessionLabel}</strong>
        </div>
        <div className="hero-metric">
          <span>Input mic</span>
          <strong>{micState}</strong>
        </div>
        <div className="hero-metric">
          <span>Output audio</span>
          <strong>{outputAudio.chunks ? `${formatDuration(outputDuration)} received` : "waiting"}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="primary-column">
          <section className="panel live-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Live transcript</p>
                <h2>{assistantSpeaking ? "Assistant speaking" : "Listening for speech"}</h2>
              </div>
              <div className="wave-group" aria-hidden="true">
                <span className={`wave ${micState === "live" ? "active" : ""}`} />
                <span className={`wave ${assistantSpeaking ? "active" : ""}`} />
                <span className="wave" />
              </div>
            </div>

            <div className="live-body">
              <div className="live-text" aria-live="polite" aria-atomic="false">
                {liveBlocks.length ? (
                  liveBlocks.map((block, index) => <p key={`${block.slice(0, 12)}-${index}`}>{block}</p>)
                ) : (
                  <p className="placeholder">
                    Start the browser microphone, speak naturally, and watch the transcript appear here.
                  </p>
                )}
              </div>
              <div className="meter-row">
                <span>Mic level</span>
                <div className="meter-track" aria-hidden="true">
                  <div className="meter-fill" style={{ width: `${Math.max(6, micLevel * 100)}%` }} />
                </div>
              </div>
            </div>
          </section>

          <section className="panel output-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Speech output</p>
                <h2>{outputAudio.active ? "Playing assistant audio" : "Assistant audio stream"}</h2>
              </div>
              <Badge tone={outputAudio.active ? "warn" : outputAudio.chunks ? "good" : "neutral"}>
                {outputAudio.active ? "playing" : outputAudio.chunks ? "received" : "idle"}
              </Badge>
            </div>

            <div className="output-body">
              <div className="speaker-visual" aria-hidden="true">
                <Volume2 size={24} />
                <div className="speaker-bars">
                  {[0.35, 0.55, 0.78, 0.48, 0.68, 0.42].map((scale, index) => (
                    <span
                      key={scale}
                      className={outputAudio.active ? "active" : ""}
                      style={{
                        height: `${Math.max(18, (outputAudio.level || scale) * 72 * scale)}px`,
                        animationDelay: `${index * 0.06}s`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="output-stats">
                <div>
                  <span>Chunks</span>
                  <strong>{outputAudio.chunks}</strong>
                </div>
                <div>
                  <span>Audio</span>
                  <strong>{formatDuration(outputDuration)}</strong>
                </div>
                <div>
                  <span>Payload</span>
                  <strong>{formatBytes(outputAudio.bytes)}</strong>
                </div>
                <div>
                  <span>Peak</span>
                  <strong>{Math.round(outputAudio.peak * 100)}%</strong>
                </div>
              </div>
              {outputAudio.url ? (
                <audio className="audio-player" src={outputAudio.url} controls preload="metadata" />
              ) : (
                <div className="audio-placeholder">Returned speech audio will appear here when the server responds.</div>
              )}
            </div>
          </section>

          <section className="panel history-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Conversation</p>
                <h2>Turn history</h2>
              </div>
              <Badge tone="neutral">{history.length} turns</Badge>
            </div>

            <div className="history-list">
              {history.length ? (
                history.map((item) => (
                  <article key={item.id} className={`turn turn-${item.role}`}>
                    <div className="turn-meta">
                      <span>{item.role === "user" ? "You" : "Assistant"}</span>
                      <time>{item.time}</time>
                    </div>
                    <p>{item.text}</p>
                    {item.role === "assistant" && item.audioChunks ? (
                      <div className="turn-audio">
                        <Radio size={14} />
                        <span>
                          {item.audioChunks} audio chunks · {formatDuration(item.audioDuration)}
                        </span>
                        {item.audioUrl ? <audio src={item.audioUrl} controls preload="metadata" /> : null}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <Waves size={20} />
                  <p>No completed turns yet.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="rail">
          <section className="panel control-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Connection</p>
                <h2>Server settings</h2>
              </div>
              <Badge tone={socketState === "connected" ? "good" : "neutral"}>
                {socketState === "connected" ? "online" : "offline"}
              </Badge>
            </div>

            <label className="field">
              <span>WebSocket URL</span>
              <input value={serverUrl} readOnly spellCheck="false" />
            </label>

            <label className="field">
              <span>Instructions</span>
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={6} />
            </label>

            <div className="button-grid">
              <Button kind="primary" icon={Server} onClick={() => void connect().catch(() => {})}>
                Connect
              </Button>
              <Button kind="secondary" icon={ArrowRight} onClick={startMic}>
                Start browser mic
              </Button>
              <Button kind="secondary" icon={CircleStop} onClick={stopMic}>
                Stop mic
              </Button>
              <Button kind="ghost" icon={RefreshCcw} onClick={disconnect}>
                Disconnect
              </Button>
            </div>

            <div className="action-row">
              <Button kind="ghost" icon={Trash2} onClick={clearConversation}>
                Clear history
              </Button>
            </div>

            <div className="helper-stack">
              <div className="device-item">
                <div>
                  <Mic size={16} />
                  <span>Input source</span>
                </div>
                <strong>{localAudio.inputLabel}</strong>
              </div>
              <div className="device-item">
                <div>
                  <Headphones size={16} />
                  <span>Output target</span>
                </div>
                <strong>{localAudio.outputLabel}</strong>
              </div>
              <div className="helper-item">
                <span>Sample rate</span>
                <strong>{TARGET_SAMPLE_RATE} Hz</strong>
              </div>
              <div className="helper-item">
                <span>Transport</span>
                <strong>OpenAI Realtime websocket</strong>
              </div>
            </div>
          </section>

          {!localAudio.secureContext || !localAudio.available ? (
            <section className="panel warning-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Browser audio</p>
                  <h2>Microphone permission</h2>
                </div>
                <Badge tone="warn">client</Badge>
              </div>
              <p>
                Browser microphone input comes from the user device. Use HTTPS or localhost so the browser can grant
                microphone access.
              </p>
            </section>
          ) : null}

          <section className="panel event-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Event log</p>
                <h2>Recent events</h2>
              </div>
              <Badge tone="neutral">{events.length}</Badge>
            </div>

            <div className="event-list">
              {events.length ? (
                events.map((item) => (
                  <div key={item.id} className="event-row">
                    <span>{item.time}</span>
                    <strong>{item.type}</strong>
                    {item.detail ? <em>{item.detail}</em> : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <AlertCircle size={20} />
                  <p>No events yet.</p>
                </div>
              )}
            </div>
          </section>

          {error ? (
            <section className="panel error-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Error</p>
                  <h2>Connection issue</h2>
                </div>
                <Badge tone="bad">attention</Badge>
              </div>
              <p>{error}</p>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
