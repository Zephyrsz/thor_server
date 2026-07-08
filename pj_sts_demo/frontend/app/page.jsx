"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

async function getRuntimeDefaultWsConfig() {
  const sameOriginUrl = getSameOriginRealtimeWsUrl();

  try {
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!response.ok) {
      return { connectionUrl: sameOriginUrl, displayUrl: sameOriginUrl };
    }

    const config = await response.json();
    const connectionUrl = normalizeRealtimeWsUrl(config.realtimeWsUrl);
    return {
      connectionUrl,
      displayUrl: config.configuredRealtimeWsUrl || connectionUrl,
    };
  } catch {
    return { connectionUrl: sameOriginUrl, displayUrl: sameOriginUrl };
  }
}

function EqBars({ color = "var(--user)", height = 24, active = false, level = 0.4, compact = false }) {
  const bars = [0.42, 0.65, 0.9, 0.58, 0.78, 0.48, 0.7, 0.36, 0.86, 0.56];
  return (
    <div className={`eq-bars ${compact ? "eq-bars-compact" : ""}`} style={{ minHeight: height }}>
      {bars.map((scale, index) => (
        <span
          key={`${scale}-${index}`}
          className={active ? "active" : ""}
          style={{
            "--bar-color": color,
            "--bar-scale": Math.max(0.25, active ? scale * Math.max(level, 0.28) : scale * 0.45),
            animationDelay: `${-index * 0.13}s`,
          }}
        />
      ))}
    </div>
  );
}

function Mascot({ role, active }) {
  const isAssistant = role === "assistant";
  return (
    <div className={`mascot ${isAssistant ? "mascot-assistant" : "mascot-user"} ${active ? "active" : ""}`}>
      {!isAssistant ? <span className="mascot-ring" aria-hidden="true" /> : null}
      <div className="mascot-face" aria-hidden="true">
        <div className="mascot-eyes">
          <span />
          <span />
        </div>
        <span className={isAssistant ? "mascot-mouth mascot-mouth-talk" : "mascot-mouth"} />
      </div>
      {isAssistant ? (
        <>
          <span className="mascot-ear mascot-ear-left" aria-hidden="true" />
          <span className="mascot-ear mascot-ear-right" aria-hidden="true" />
        </>
      ) : (
        <span className="mascot-mic" aria-hidden="true">
          <span />
        </span>
      )}
    </div>
  );
}

function StatusPill({ state }) {
  const connected = state === "connected";
  return (
    <div className={`status-pill ${connected ? "status-pill-connected" : ""}`}>
      <span className="status-dot" />
      <span>{connected ? "已连接 CONNECTED" : "未连接 OFFLINE"}</span>
    </div>
  );
}

function Metric({ label, children, mono = false }) {
  return (
    <div className="metric-card">
      <div>{label}</div>
      <strong className={mono ? "mono" : ""}>{children}</strong>
    </div>
  );
}

function AudioPlayback({ url, duration, chunks, active, peak }) {
  return (
    <div className="inline-player">
      {url ? (
        <audio src={url} controls preload="metadata" />
      ) : (
        <>
          <button className="play-button" type="button" disabled>
            ▶
          </button>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: active ? "44%" : chunks ? "100%" : "8%" }} />
          </div>
        </>
      )}
      <span className="mono">{duration}</span>
      {Number.isFinite(peak) ? <span className="player-meta">峰值 {Math.round(peak * 100)}%</span> : null}
    </div>
  );
}

export default function Page() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_WS_URL);
  const [displayServerUrl, setDisplayServerUrl] = useState(DEFAULT_WS_URL);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLog, setShowLog] = useState(false);
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
  const leftColumnRef = useRef(null);
  const rightColumnRef = useRef(null);
  const conversationRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function loadSavedSettings() {
      const runtimeDefaultWsConfig = await getRuntimeDefaultWsConfig();
      if (!active) return;

      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setServerUrl(runtimeDefaultWsConfig.connectionUrl);
        setDisplayServerUrl(runtimeDefaultWsConfig.displayUrl);
        setSettingsLoaded(true);
        return;
      }

      try {
        const parsed = JSON.parse(stored);
        setServerUrl(runtimeDefaultWsConfig.connectionUrl);
        setDisplayServerUrl(runtimeDefaultWsConfig.displayUrl);
        if (parsed.instructions) setInstructions(parsed.instructions);
      } catch {
        setServerUrl(runtimeDefaultWsConfig.connectionUrl);
        setDisplayServerUrl(runtimeDefaultWsConfig.displayUrl);
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

  useEffect(() => {
    function syncColumns() {
      const left = leftColumnRef.current;
      const right = rightColumnRef.current;
      if (!left || !right || window.innerWidth <= 1120) {
        if (left) left.style.height = "";
        return;
      }

      left.style.height = `${right.offsetHeight}px`;
    }

    syncColumns();
    const observer = new ResizeObserver(syncColumns);
    if (rightColumnRef.current) observer.observe(rightColumnRef.current);
    window.addEventListener("resize", syncColumns);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncColumns);
    };
  }, [showAdvanced, showLog, error, localAudio.inputLabel, localAudio.outputLabel]);

  useEffect(() => {
    const node = conversationRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [history.length, outputAudio.url]);

  const outputDuration = outputAudio.samples / TARGET_SAMPLE_RATE;
  const connected = socketState === "connected";
  const micLive = micState === "live" || micState === "listening";
  const outputLabel = outputAudio.chunks ? `${formatDuration(outputDuration)} received` : "waiting";
  const currentUserText = liveUser || (micLive ? "正在接收浏览器麦克风输入…" : "Start the browser microphone, speak naturally, and watch the transcript appear here.");
  const currentAssistantText =
    liveAssistant || (assistantSpeaking ? "Assistant speech is streaming back from the server." : "Returned speech audio will appear here when the server responds.");

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
    setEvents((current) => [{ id: makeId("event"), type, detail, time: nowLabel() }, ...current].slice(0, 40));
  }

  function pushHistory(role, text, meta = {}) {
    if (!text.trim()) return;
    setHistory((current) => [
      ...current,
      {
        id: makeId("turn"),
        role,
        text: text.trim(),
        time: nowLabel(),
        ...meta,
      },
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
                audioBytes: audio.bytes,
                audioPeak: audio.peak,
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
        if (!settled) reject(new Error("WebSocket connection failed."));
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setSocketState("disconnected");
        setMicState("idle");
        setAssistantSpeaking(false);
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
  }

  function clearConversation() {
    if (history.length && !window.confirm("清空当前对话历史？")) return;
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

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div>
            <h1>Real-time speech AI</h1>
          </div>
          <StatusPill state={socketState} />
        </header>

        <section className="status-strip" aria-label="Session overview">
          <Metric label="端点 · Endpoint" mono>
            {displayServerUrl || serverUrl || "loading"}
          </Metric>
          <Metric label="会话 · Session">{sessionLabel}</Metric>
          <Metric label="麦克风 · Mic">{micLive ? "采集中" : micState}</Metric>
          <Metric label="输出音频 · Output">{outputLabel}</Metric>
        </section>

        <section className="main-grid">
          <div className="left-column" data-role="leftcol" ref={leftColumnRef}>
            <section className="live-grid" aria-label="Realtime interaction">
              <article className="live-card live-card-user">
                <div className="card-head">
                  <div>
                    <p>Live transcript</p>
                    <h2>Listening for speech</h2>
                  </div>
                  <span className="role-badge role-badge-user">你 · YOU</span>
                </div>
                <div className="live-card-body live-card-body-user">
                  <Mascot role="user" active={micLive} />
                  <div className="live-copy">
                    <div className={`state-line ${micLive ? "active" : ""}`}>
                      <span />
                      正在聆听 · LISTENING
                    </div>
                    <p>{currentUserText}</p>
                    <div className="input-level">
                      <span>输入电平</span>
                      <EqBars color="var(--user)" height={24} active={micLive} level={Math.max(0.28, micLevel)} />
                    </div>
                  </div>
                </div>
              </article>

              <article className="live-card live-card-assistant">
                <div className="card-head">
                  <div>
                    <p>Speech output</p>
                    <h2>Assistant audio stream</h2>
                  </div>
                  <span className="role-badge role-badge-assistant">语音助手 · AI</span>
                </div>
                <div className="live-card-body">
                  <Mascot role="assistant" active={assistantSpeaking} />
                  <div className="live-copy">
                    <div className={`state-line state-line-assistant ${assistantSpeaking ? "active" : ""}`}>
                      <span />
                      正在播放 · SPEAKING
                    </div>
                    <EqBars
                      color="var(--assistant)"
                      height={30}
                      active={assistantSpeaking || outputAudio.active}
                      level={Math.max(0.3, outputAudio.level)}
                    />
                    <p>{currentAssistantText}</p>
                    <AudioPlayback
                      url={outputAudio.url}
                      duration={formatDuration(outputDuration)}
                      chunks={outputAudio.chunks}
                      active={outputAudio.active}
                      peak={outputAudio.peak}
                    />
                  </div>
                </div>
              </article>
            </section>

            <section className="conversation-panel">
              <div className="conversation-head">
                <div>
                  <p>Conversation</p>
                  <h2>对话记录</h2>
                </div>
                <div className="legend-row">
                  <span>
                    <i className="legend-user" />
                    你
                  </span>
                  <span>
                    <i className="legend-assistant" />
                    语音助手
                  </span>
                  <strong>{history.length} 轮</strong>
                </div>
              </div>

              <div className="conversation-scroll" ref={conversationRef}>
                {history.length ? (
                  history.map((item) => (
                    <article key={item.id} className={`turn-row turn-row-${item.role}`}>
                      <div className="turn-bubble-wrap">
                        <div className="turn-meta">
                          <span>{item.role === "user" ? "你 · YOU" : "语音助手 · ASSISTANT"}</span>
                          <time>{item.time}</time>
                        </div>
                        <div className="turn-bubble">
                          <p>{item.text}</p>
                          {item.role === "assistant" && item.audioChunks ? (
                            <div className="turn-audio">
                              <AudioPlayback
                                url={item.audioUrl}
                                duration={formatDuration(item.audioDuration)}
                                chunks={item.audioChunks}
                                active={false}
                                peak={item.audioPeak}
                              />
                              <span>
                                {item.audioChunks} 段音频 · {formatDuration(item.audioDuration)} · {formatBytes(item.audioBytes)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>No completed turns yet.</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="right-column" data-role="rightcol" ref={rightColumnRef}>
            <section className="side-panel session-panel">
              <p>Session</p>
              <h2>会话控制</h2>
              <button className="primary-action" type="button" onClick={connected ? disconnect : () => void connect().catch(() => {})}>
                {connected ? "断开连接" : "连接服务器"}
              </button>
              <button className="secondary-action" type="button" onClick={micRef.current ? stopMic : startMic}>
                <span className={micLive ? "action-dot action-dot-on" : "action-dot"} />
                {micRef.current ? "停止麦克风" : "启动浏览器麦克风"}
              </button>
              <button className="weak-action" type="button" onClick={clearConversation}>
                清空对话历史
              </button>
              {error ? (
                <div className="side-alert side-alert-error">
                  <strong>Connection issue</strong>
                  <span>{error}</span>
                </div>
              ) : null}
              {!localAudio.secureContext || !localAudio.available ? (
                <div className="side-alert">
                  <strong>Browser audio</strong>
                  <span>Use HTTPS or localhost so the browser can grant microphone access.</span>
                </div>
              ) : null}
            </section>

            <section className="side-panel devices-panel">
              <p>Devices · 设备</p>
              <div className="device-row">
                <span>输入</span>
                <strong>{localAudio.inputLabel}</strong>
              </div>
              <div className="device-row">
                <span>输出</span>
                <strong>{localAudio.outputLabel}</strong>
              </div>
            </section>

            <section className="side-panel instructions-panel">
              <div className="side-head-row">
                <div>
                  <p>Instructions</p>
                  <h2>系统提示词</h2>
                </div>
                <span>System prompt</span>
              </div>
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={6} />
            </section>

            <section className="collapse-panel">
              <button type="button" onClick={() => setShowAdvanced((value) => !value)}>
                <span>高级设置 · Advanced</span>
                <span>{showAdvanced ? "收起 ▾" : "展开 ▸"}</span>
              </button>
              {showAdvanced ? (
                <div className="collapse-body">
                  <label>
                    <span>Remote realtime URL</span>
                    <input value={displayServerUrl || serverUrl} readOnly spellCheck="false" />
                  </label>
                  <label>
                    <span>Browser WebSocket URL</span>
                    <input value={serverUrl} readOnly spellCheck="false" />
                  </label>
                  <div className="setting-row">
                    <span>采样率 Sample rate</span>
                    <strong className="mono">{TARGET_SAMPLE_RATE} Hz</strong>
                  </div>
                  <div className="setting-row">
                    <span>传输 Transport</span>
                    <strong>OpenAI Realtime WS</strong>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="collapse-panel">
              <button type="button" onClick={() => setShowLog((value) => !value)}>
                <span>
                  开发者日志 · Log <strong>{events.length}</strong>
                </span>
                <span>{showLog ? "收起 ▾" : "展开 ▸"}</span>
              </button>
              {showLog ? (
                <div className="developer-log">
                  {events.length ? (
                    events.map((item) => (
                      <div className="event-row" key={item.id}>
                        <time>{item.time}</time>
                        <strong>{item.type}</strong>
                        {item.detail ? <span>{item.detail}</span> : null}
                      </div>
                    ))
                  ) : (
                    <div className="log-empty">No events yet.</div>
                  )}
                </div>
              ) : null}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
