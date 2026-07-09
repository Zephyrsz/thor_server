"use client";

import { useEffect, useRef, useState } from "react";
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
const DEFAULT_LANGUAGE = "zh";
const DEFAULT_INSTRUCTIONS =
  "You are a concise, helpful voice assistant. Keep replies natural and brief unless the user asks for detail.";
const LANGUAGE_OPTIONS = [
  { code: "zh", label: "中文", flag: "🇨🇳", htmlLang: "zh-CN" },
  { code: "ja", label: "日本語", flag: "🇯🇵", htmlLang: "ja" },
  { code: "en", label: "English", flag: "🇬🇧", htmlLang: "en" },
];

const TRANSLATIONS = {
  zh: {
    title: "实时语音 AI",
    languageLabel: "页面语言",
    aria: {
      sessionOverview: "会话概览",
      realtimeInteraction: "实时交互",
    },
    status: {
      connected: "已连接 CONNECTED",
      offline: "未连接 OFFLINE",
      endpoint: "端点 · Endpoint",
      session: "会话 · Session",
      mic: "麦克风 · Mic",
      output: "输出音频 · Output",
      loading: "加载中",
      capturing: "采集中",
      waiting: "等待中",
      outputReceived: "received",
    },
    sessionLabel: {
      notConnected: "未连接",
      sessionActive: "会话连接中",
      sessionReady: "会话就绪",
    },
    micState: {
      idle: "空闲",
      connecting: "连接中",
      listening: "聆听中",
      live: "采集中",
      error: "错误",
    },
    live: {
      userKicker: "Live transcript",
      userTitle: "Listening for speech",
      assistantKicker: "Speech output",
      assistantTitle: "Assistant audio stream",
      userRole: "你 · YOU",
      assistantRole: "语音助手 · AI",
      userState: "正在聆听 · LISTENING",
      assistantState: "正在播放 · SPEAKING",
      userPlaceholder: "启动浏览器麦克风，自然说话，实时转写会显示在这里。",
      userListening: "正在接收浏览器麦克风输入…",
      assistantPlaceholder: "服务器返回语音后，文本和音频会显示在这里。",
      assistantSpeaking: "语音助手正在从服务器返回音频。",
      inputLevel: "输入电平",
    },
    conversation: {
      kicker: "Conversation",
      title: "对话记录",
      userLegend: "你",
      assistantLegend: "语音助手",
      turns: (count) => `${count} 轮`,
      empty: "还没有完成的对话。",
      assistantMeta: "语音助手 · ASSISTANT",
    },
    controls: {
      sessionKicker: "Session",
      sessionTitle: "会话控制",
      connect: "连接服务器",
      disconnect: "断开连接",
      startMic: "启动浏览器麦克风",
      stopMic: "停止麦克风",
      clearHistory: "清空对话历史",
      confirmClear: "清空当前对话历史？",
    },
    devices: {
      title: "Devices · 设备",
      input: "输入",
      output: "输出",
      microphone: "浏览器麦克风",
      speakers: "浏览器扬声器",
    },
    instructions: {
      kicker: "Instructions",
      title: "系统提示词",
      tag: "System prompt",
    },
    advanced: {
      title: "高级设置 · Advanced",
      expand: "展开 ▸",
      collapse: "收起 ▾",
      remoteUrl: "Remote realtime URL",
      browserUrl: "Browser WebSocket URL",
      sampleRate: "采样率 Sample rate",
      transport: "传输 Transport",
      transportValue: "OpenAI Realtime WS",
    },
    log: {
      title: "开发者日志 · Log",
      empty: "暂无事件。",
    },
    alerts: {
      connection: "连接问题",
      browserAudio: "浏览器音频",
      browserAudioDetail: "请使用 HTTPS 或 localhost 打开页面，浏览器才能授权麦克风。",
    },
    errors: {
      websocketFailed: "WebSocket 连接失败。",
      websocketRequired: "请先连接 WebSocket，再启动麦克风。",
      connectFailed: "无法连接到 WebSocket。",
      micUnavailable: "当前浏览器不可用麦克风。",
      micStartFailed: "无法启动麦克风。",
      serverError: "服务器返回错误。",
      transcriptionFailed: "语音转写失败。",
    },
    assistantGenerating: "正在生成回复…",
    assistantAudioReceived: "已收到语音助手音频。",
    audio: {
      peak: (value) => `峰值 ${value}%`,
      summary: (chunks, duration, bytes) => `${chunks} 段音频 · ${duration} · ${bytes}`,
    },
  },
  ja: {
    title: "リアルタイム音声 AI",
    languageLabel: "ページ言語",
    aria: {
      sessionOverview: "セッション概要",
      realtimeInteraction: "リアルタイム操作",
    },
    status: {
      connected: "接続済み CONNECTED",
      offline: "未接続 OFFLINE",
      endpoint: "エンドポイント · Endpoint",
      session: "セッション · Session",
      mic: "マイク · Mic",
      output: "出力音声 · Output",
      loading: "読み込み中",
      capturing: "収録中",
      waiting: "待機中",
      outputReceived: "受信済み",
    },
    sessionLabel: {
      notConnected: "未接続",
      sessionActive: "セッション接続中",
      sessionReady: "セッション準備完了",
    },
    micState: {
      idle: "待機中",
      connecting: "接続中",
      listening: "聞き取り中",
      live: "収録中",
      error: "エラー",
    },
    live: {
      userKicker: "Live transcript",
      userTitle: "音声を聞き取り中",
      assistantKicker: "Speech output",
      assistantTitle: "アシスタント音声ストリーム",
      userRole: "あなた · YOU",
      assistantRole: "音声アシスタント · AI",
      userState: "聞き取り中 · LISTENING",
      assistantState: "再生中 · SPEAKING",
      userPlaceholder: "ブラウザのマイクを開始して話すと、文字起こしがここに表示されます。",
      userListening: "ブラウザのマイク入力を受信中…",
      assistantPlaceholder: "サーバーから返る音声とテキストがここに表示されます。",
      assistantSpeaking: "アシスタント音声をサーバーから受信しています。",
      inputLevel: "入力レベル",
    },
    conversation: {
      kicker: "Conversation",
      title: "会話履歴",
      userLegend: "あなた",
      assistantLegend: "音声アシスタント",
      turns: (count) => `${count} ターン`,
      empty: "完了した会話はまだありません。",
      assistantMeta: "音声アシスタント · ASSISTANT",
    },
    controls: {
      sessionKicker: "Session",
      sessionTitle: "セッション操作",
      connect: "サーバーに接続",
      disconnect: "切断",
      startMic: "ブラウザマイクを開始",
      stopMic: "マイクを停止",
      clearHistory: "会話履歴を消去",
      confirmClear: "現在の会話履歴を消去しますか？",
    },
    devices: {
      title: "Devices · デバイス",
      input: "入力",
      output: "出力",
      microphone: "ブラウザマイク",
      speakers: "ブラウザスピーカー",
    },
    instructions: {
      kicker: "Instructions",
      title: "システム指示",
      tag: "System prompt",
    },
    advanced: {
      title: "詳細設定 · Advanced",
      expand: "展開 ▸",
      collapse: "閉じる ▾",
      remoteUrl: "Remote realtime URL",
      browserUrl: "Browser WebSocket URL",
      sampleRate: "サンプルレート Sample rate",
      transport: "転送方式 Transport",
      transportValue: "OpenAI Realtime WS",
    },
    log: {
      title: "開発者ログ · Log",
      empty: "イベントはまだありません。",
    },
    alerts: {
      connection: "接続の問題",
      browserAudio: "ブラウザ音声",
      browserAudioDetail: "マイク許可には HTTPS または localhost で開いてください。",
    },
    errors: {
      websocketFailed: "WebSocket 接続に失敗しました。",
      websocketRequired: "マイクを開始する前に WebSocket に接続してください。",
      connectFailed: "WebSocket に接続できませんでした。",
      micUnavailable: "このブラウザではマイクを利用できません。",
      micStartFailed: "マイクを開始できませんでした。",
      serverError: "サーバーがエラーを返しました。",
      transcriptionFailed: "音声認識に失敗しました。",
    },
    assistantGenerating: "応答を生成中…",
    assistantAudioReceived: "アシスタント音声を受信しました。",
    audio: {
      peak: (value) => `ピーク ${value}%`,
      summary: (chunks, duration, bytes) => `${chunks} 音声チャンク · ${duration} · ${bytes}`,
    },
  },
  en: {
    title: "Real-time speech AI",
    languageLabel: "Page language",
    aria: {
      sessionOverview: "Session overview",
      realtimeInteraction: "Realtime interaction",
    },
    status: {
      connected: "CONNECTED",
      offline: "OFFLINE",
      endpoint: "Endpoint",
      session: "Session",
      mic: "Mic",
      output: "Output audio",
      loading: "loading",
      capturing: "capturing",
      waiting: "waiting",
      outputReceived: "received",
    },
    sessionLabel: {
      notConnected: "not connected",
      sessionActive: "session active",
      sessionReady: "session ready",
    },
    micState: {
      idle: "idle",
      connecting: "connecting",
      listening: "listening",
      live: "capturing",
      error: "error",
    },
    live: {
      userKicker: "Live transcript",
      userTitle: "Listening for speech",
      assistantKicker: "Speech output",
      assistantTitle: "Assistant audio stream",
      userRole: "You",
      assistantRole: "Voice assistant · AI",
      userState: "Listening",
      assistantState: "Speaking",
      userPlaceholder: "Start the browser microphone, speak naturally, and watch the transcript appear here.",
      userListening: "Receiving browser microphone input…",
      assistantPlaceholder: "Returned speech audio and text will appear here when the server responds.",
      assistantSpeaking: "Assistant speech is streaming back from the server.",
      inputLevel: "Input level",
    },
    conversation: {
      kicker: "Conversation",
      title: "History",
      userLegend: "You",
      assistantLegend: "Voice assistant",
      turns: (count) => `${count} turns`,
      empty: "No completed turns yet.",
      assistantMeta: "Voice assistant · ASSISTANT",
    },
    controls: {
      sessionKicker: "Session",
      sessionTitle: "Session controls",
      connect: "Connect server",
      disconnect: "Disconnect",
      startMic: "Start browser microphone",
      stopMic: "Stop microphone",
      clearHistory: "Clear conversation history",
      confirmClear: "Clear the current conversation history?",
    },
    devices: {
      title: "Devices",
      input: "Input",
      output: "Output",
      microphone: "Browser microphone",
      speakers: "Browser speakers",
    },
    instructions: {
      kicker: "Instructions",
      title: "System prompt",
      tag: "System prompt",
    },
    advanced: {
      title: "Advanced settings",
      expand: "Expand ▸",
      collapse: "Collapse ▾",
      remoteUrl: "Remote realtime URL",
      browserUrl: "Browser WebSocket URL",
      sampleRate: "Sample rate",
      transport: "Transport",
      transportValue: "OpenAI Realtime WS",
    },
    log: {
      title: "Developer log",
      empty: "No events yet.",
    },
    alerts: {
      connection: "Connection issue",
      browserAudio: "Browser audio",
      browserAudioDetail: "Use HTTPS or localhost so the browser can grant microphone access.",
    },
    errors: {
      websocketFailed: "WebSocket connection failed.",
      websocketRequired: "Connect to the websocket before starting the microphone.",
      connectFailed: "Could not connect to the websocket.",
      micUnavailable: "Microphone access is not available in this browser.",
      micStartFailed: "Could not start the microphone.",
      serverError: "The server returned an error.",
      transcriptionFailed: "Speech transcription failed.",
    },
    assistantGenerating: "Generating a reply…",
    assistantAudioReceived: "Assistant speech audio received.",
    audio: {
      peak: (value) => `Peak ${value}%`,
      summary: (chunks, duration, bytes) => `${chunks} audio chunks · ${duration} · ${bytes}`,
    },
  },
};

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

function textFromContent(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join("");
  if (typeof value !== "object") return "";

  if (typeof value.text === "string") return value.text;
  if (typeof value.transcript === "string") return value.transcript;
  if (typeof value.delta === "string") return value.delta;
  return textFromContent(value.content) || textFromContent(value.output);
}

function textFromEvent(event) {
  return (
    textFromContent(event.delta) ||
    textFromContent(event.text) ||
    textFromContent(event.transcript) ||
    textFromContent(event.item?.content) ||
    textFromContent(event.response?.output)
  );
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

function StatusPill({ state, labels }) {
  const connected = state === "connected";
  return (
    <div className={`status-pill ${connected ? "status-pill-connected" : ""}`}>
      <span className="status-dot" />
      <span>{connected ? labels.connected : labels.offline}</span>
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

function AudioPlayback({ url, duration, chunks, active, peak, labels = TRANSLATIONS.zh.audio }) {
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
      {Number.isFinite(peak) ? <span className="player-meta">{labels.peak(Math.round(peak * 100))}</span> : null}
    </div>
  );
}

export default function Page() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_WS_URL);
  const [displayServerUrl, setDisplayServerUrl] = useState(DEFAULT_WS_URL);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
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
  const [sessionLabel, setSessionLabel] = useState("notConnected");
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
  const assistantAudioChunksRef = useRef([]);
  const userTurnKeyRef = useRef("");
  const assistantTurnKeyRef = useRef("");
  const audioUrlsRef = useRef([]);
  const leftColumnRef = useRef(null);
  const rightColumnRef = useRef(null);
  const conversationRef = useRef(null);
  const t = TRANSLATIONS[language] || TRANSLATIONS[DEFAULT_LANGUAGE];
  const selectedLanguage = LANGUAGE_OPTIONS.find((option) => option.code === language) || LANGUAGE_OPTIONS[0];

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
        if (LANGUAGE_OPTIONS.some((option) => option.code === parsed.language)) {
          setLanguage(parsed.language);
        }
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ instructions, language }));
  }, [instructions, language, settingsLoaded]);

  useEffect(() => {
    document.documentElement.lang = selectedLanguage.htmlLang;
  }, [selectedLanguage.htmlLang]);

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
  const outputLabel = outputAudio.chunks ? `${formatDuration(outputDuration)} ${t.status.outputReceived}` : t.status.waiting;
  const currentUserText = liveUser || (micLive ? t.live.userListening : t.live.userPlaceholder);
  const currentAssistantText =
    liveAssistant || (assistantSpeaking ? t.live.assistantSpeaking : t.live.assistantPlaceholder);
  const displaySessionLabel = t.sessionLabel[sessionLabel] || sessionLabel;
  const displayMicState = micLive ? t.status.capturing : t.micState[micState] || micState;
  const inputDeviceLabel = localAudio.inputLabel === "Browser microphone" ? t.devices.microphone : localAudio.inputLabel;
  const outputDeviceLabel = localAudio.outputLabel === "Browser speakers" ? t.devices.speakers : localAudio.outputLabel;

  function setOutputAudioState(updater) {
    const next = typeof updater === "function" ? updater(outputAudioRef.current) : updater;
    outputAudioRef.current = next;
    setOutputAudio(next);
    return next;
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

  function upsertHistory(key, role, text, meta = {}) {
    const cleanText = String(text || "").trim();
    if (!key || (!cleanText && !meta.audioChunks && !meta.pending)) return;

    setHistory((current) => {
      const index = current.findIndex((item) => item.key === key);
      const existing = index >= 0 ? current[index] : null;
      const next = {
        ...(existing || { id: makeId("turn"), key, role, time: nowLabel() }),
        role,
        text: cleanText || existing?.text || (meta.audioChunks ? t.assistantAudioReceived : "…"),
        ...meta,
      };

      if (index < 0) return [...current, next];

      const updated = [...current];
      updated[index] = next;
      return updated;
    });
  }

  function getUserTurnKey(event = {}) {
    const key = event.item_id || event.item?.id || userTurnKeyRef.current || makeId("user-turn");
    userTurnKeyRef.current = key;
    return key;
  }

  function getAssistantTurnKey(event = {}) {
    const key =
      event.response_id ||
      event.response?.id ||
      event.item_id ||
      event.item?.id ||
      assistantTurnKeyRef.current ||
      makeId("assistant-turn");
    assistantTurnKeyRef.current = key;
    return key;
  }

  function audioHistoryMeta(audio = outputAudioRef.current, overrides = {}) {
    return {
      kind: audio.chunks ? "speech response" : "response",
      audioChunks: audio.chunks,
      audioDuration: audio.samples / TARGET_SAMPLE_RATE,
      audioUrl: audio.url,
      audioBytes: audio.bytes,
      audioPeak: audio.peak,
      ...overrides,
    };
  }

  function updateAssistantHistory(event = {}, text = assistantTranscriptRef.current, meta = {}) {
    const audio = outputAudioRef.current;
    upsertHistory(
      getAssistantTurnKey(event),
      "assistant",
      text || (audio.chunks ? t.assistantAudioReceived : t.assistantGenerating),
      audioHistoryMeta(audio, meta)
    );
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
        setSessionLabel("sessionActive");
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
            setSessionLabel("sessionReady");
            break;
          case "input_audio_buffer.speech_started":
            userTurnKeyRef.current = event.item_id || makeId("user-turn");
            setLiveUser("");
            liveUserRef.current = "";
            setLiveAssistant("");
            setAssistantSpeaking(false);
            resetOutputAudio(false);
            setMicState("listening");
            break;
          case "input_audio_buffer.speech_stopped":
            setMicState(micRef.current ? "live" : "idle");
            break;
          case "conversation.item.input_audio_transcription.delta":
            setLiveUser((current) => {
              const next = `${current}${event.delta ?? ""}`;
              liveUserRef.current = next;
              upsertHistory(getUserTurnKey(event), "user", next, { kind: "transcript", pending: true });
              return next;
            });
            break;
          case "conversation.item.input_audio_transcription.completed": {
            const transcript = event.transcript ?? "";
            const text = transcript || liveUserRef.current;
            upsertHistory(getUserTurnKey(event), "user", text, {
              kind: "transcript",
              pending: false,
              audioDuration: event.usage?.seconds,
            });
            setLiveUser("");
            liveUserRef.current = "";
            userTurnKeyRef.current = "";
            break;
          }
          case "conversation.item.input_audio_transcription.failed": {
            const detail = event.error?.message || t.errors.transcriptionFailed;
            upsertHistory(getUserTurnKey(event), "user", detail, { kind: "transcript error", pending: false });
            setLiveUser("");
            liveUserRef.current = "";
            userTurnKeyRef.current = "";
            break;
          }
          case "conversation.item.created": {
            const item = event.item || {};
            const text = textFromContent(item.content);
            if (item.role === "user" && text) {
              upsertHistory(item.id || makeId("user-turn"), "user", text, { kind: "text input", pending: false });
            } else if (item.role === "assistant" && text) {
              upsertHistory(item.id || makeId("assistant-turn"), "assistant", text, { kind: "text response", pending: false });
            }
            break;
          }
          case "response.created":
            {
              const responseKey = event.response?.id || assistantTurnKeyRef.current || makeId("assistant-turn");
              const sameResponse = assistantTurnKeyRef.current === responseKey;
              assistantTurnKeyRef.current = responseKey;
              if (!sameResponse) {
                setLiveAssistant("");
                assistantTranscriptRef.current = "";
                assistantAudioChunksRef.current = [];
                resetOutputAudio(true);
              } else {
                setOutputAudioState((current) => ({ ...current, active: true }));
              }
              setAssistantSpeaking(true);
              updateAssistantHistory(event, assistantTranscriptRef.current || t.assistantGenerating, { pending: true });
            }
            break;
          case "response.text.delta":
          case "response.output_text.delta":
          case "response.audio_transcript.delta":
          case "response.output_audio_transcript.delta": {
            const delta = textFromEvent(event);
            if (!delta) break;
            const next = `${assistantTranscriptRef.current}${delta}`;
            assistantTranscriptRef.current = next;
            setLiveAssistant(next);
            updateAssistantHistory(event, next, { pending: true });
            break;
          }
          case "response.text.done":
          case "response.output_text.done":
          case "response.audio_transcript.done":
          case "response.output_audio_transcript.done": {
            const transcript = textFromEvent(event);
            setLiveAssistant(transcript);
            assistantTranscriptRef.current = transcript;
            updateAssistantHistory(event, transcript, { pending: outputAudioRef.current.active });
            break;
          }
          case "response.audio.delta":
          case "response.output_audio.delta": {
            const stats = audioStatsFromBase64(event.delta ?? "");
            setAssistantSpeaking(true);
            if (event.delta) {
              assistantAudioChunksRef.current.push(event.delta);
            }
            const nextAudio = setOutputAudioState((current) => ({
              ...current,
              chunks: current.chunks + 1,
              bytes: current.bytes + stats.bytes,
              samples: current.samples + stats.samples,
              level: Math.min(1, stats.rms * 6),
              peak: Math.max(current.peak, stats.peak),
              active: true,
              lastUpdated: nowLabel(),
            }));
            updateAssistantHistory(event, assistantTranscriptRef.current, audioHistoryMeta(nextAudio, { pending: true }));
            await playerRef.current?.enqueue?.(event.delta ?? "");
            break;
          }
          case "response.audio.done":
          case "response.output_audio.done": {
            setAssistantSpeaking(false);
            const completedAudioUrl = outputAudioRef.current.url || createAssistantAudioUrl();
            const nextAudio = setOutputAudioState((current) => ({
              ...current,
              active: false,
              level: 0,
              url: completedAudioUrl,
            }));
            updateAssistantHistory(event, assistantTranscriptRef.current, audioHistoryMeta(nextAudio, { pending: false }));
            break;
          }
          case "response.done": {
            setAssistantSpeaking(false);
            const audioUrl = outputAudioRef.current.url || createAssistantAudioUrl();
            const nextAudio = setOutputAudioState((current) => ({ ...current, active: false, level: 0, url: audioUrl }));
            const responseText = textFromEvent(event);
            if (responseText) {
              assistantTranscriptRef.current = responseText;
              setLiveAssistant(responseText);
            }
            updateAssistantHistory(event, responseText || assistantTranscriptRef.current, audioHistoryMeta(nextAudio, { pending: false }));
            assistantTurnKeyRef.current = "";
            break;
          }
          case "error":
            setSocketState("error");
            setError(event.error?.message || event.message || t.errors.serverError);
            break;
          default:
            break;
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setSocketState("error");
        setError(t.errors.websocketFailed);
        if (!settled) reject(new Error(t.errors.websocketFailed));
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setSocketState("disconnected");
        setMicState("idle");
        setAssistantSpeaking(false);
        pushEvent("socket.close", targetUrl);
        socketRef.current = null;
        if (!settled) reject(new Error(t.errors.websocketFailed));
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
    setSessionLabel("notConnected");
    setMicState("idle");
    setMicLevel(0);
    setAssistantSpeaking(false);
    setLiveUser("");
    setLiveAssistant("");
    assistantTranscriptRef.current = "";
    assistantAudioChunksRef.current = [];
    userTurnKeyRef.current = "";
    assistantTurnKeyRef.current = "";
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
      setError(nextError instanceof Error ? nextError.message : t.errors.connectFailed);
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError(t.errors.websocketRequired);
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
      setError(nextError instanceof Error ? nextError.message : t.errors.micStartFailed);
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
    if (history.length && !window.confirm(t.controls.confirmClear)) return;
    setHistory([]);
    setEvents([]);
    setLiveUser("");
    setLiveAssistant("");
    liveUserRef.current = "";
    assistantTranscriptRef.current = "";
    assistantAudioChunksRef.current = [];
    userTurnKeyRef.current = "";
    assistantTurnKeyRef.current = "";
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
            <h1>{t.title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="language-switch" data-label={selectedLanguage.label} aria-label={t.languageLabel}>
              <span className="language-flag" aria-hidden="true">
                {selectedLanguage.flag}
              </span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                aria-label={t.languageLabel}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.flag} {option.label}
                  </option>
                ))}
              </select>
              <span className="language-chevron" aria-hidden="true">
                ▾
              </span>
            </div>
            <StatusPill state={socketState} labels={t.status} />
          </div>
        </header>

        <section className="status-strip" aria-label={t.aria.sessionOverview}>
          <Metric label={t.status.endpoint} mono>
            {displayServerUrl || serverUrl || t.status.loading}
          </Metric>
          <Metric label={t.status.session}>{displaySessionLabel}</Metric>
          <Metric label={t.status.mic}>{displayMicState}</Metric>
          <Metric label={t.status.output}>{outputLabel}</Metric>
        </section>

        <section className="main-grid">
          <div className="left-column" data-role="leftcol" ref={leftColumnRef}>
            <section className="live-grid" aria-label={t.aria.realtimeInteraction}>
              <article className="live-card live-card-user">
                <div className="card-head">
                  <div>
                    <p>{t.live.userKicker}</p>
                    <h2>{t.live.userTitle}</h2>
                  </div>
                </div>
                <div className="live-card-body live-card-body-user live-card-body-stage">
                  <div className="role-stage">
                    <span className="role-badge role-badge-user">{t.live.userRole}</span>
                    <Mascot role="user" active={micLive} />
                  </div>
                  <div className="live-copy">
                    <div className={`state-line ${micLive ? "active" : ""}`}>
                      <span />
                      {t.live.userState}
                    </div>
                    <p>{currentUserText}</p>
                    <div className="input-level">
                      <span>{t.live.inputLevel}</span>
                      <EqBars color="var(--user)" height={24} active={micLive} level={Math.max(0.28, micLevel)} />
                    </div>
                  </div>
                </div>
              </article>

              <article className="live-card live-card-assistant">
                <div className="card-head">
                  <div>
                    <p>{t.live.assistantKicker}</p>
                    <h2>{t.live.assistantTitle}</h2>
                  </div>
                </div>
                <div className="live-card-body live-card-body-stage">
                  <div className="role-stage role-stage-assistant">
                    <span className="role-badge role-badge-assistant">{t.live.assistantRole}</span>
                    <Mascot role="assistant" active={assistantSpeaking} />
                  </div>
                  <div className="live-copy assistant-copy">
                    <div className={`state-line state-line-assistant ${assistantSpeaking ? "active" : ""}`}>
                      <span />
                      {t.live.assistantState}
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
                      labels={t.audio}
                    />
                  </div>
                </div>
              </article>
            </section>

            <section className="conversation-panel">
              <div className="conversation-head">
                <div>
                  <p>{t.conversation.kicker}</p>
                  <h2>{t.conversation.title}</h2>
                </div>
                <div className="legend-row">
                  <span>
                    <i className="legend-user" />
                    {t.conversation.userLegend}
                  </span>
                  <span>
                    <i className="legend-assistant" />
                    {t.conversation.assistantLegend}
                  </span>
                  <strong>{t.conversation.turns(history.length)}</strong>
                </div>
              </div>

              <div className="conversation-scroll" ref={conversationRef}>
                {history.length ? (
                  history.map((item) => (
                    <article key={item.id} className={`turn-row turn-row-${item.role}`}>
                      <div className="turn-bubble-wrap">
                        <div className="turn-meta">
                          <span>{item.role === "user" ? t.live.userRole : t.conversation.assistantMeta}</span>
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
                                labels={t.audio}
                              />
                              <span>{t.audio.summary(item.audioChunks, formatDuration(item.audioDuration), formatBytes(item.audioBytes))}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>{t.conversation.empty}</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="right-column" data-role="rightcol" ref={rightColumnRef}>
            <section className="side-panel session-panel">
              <p>{t.controls.sessionKicker}</p>
              <h2>{t.controls.sessionTitle}</h2>
              <button className="primary-action" type="button" onClick={connected ? disconnect : () => void connect().catch(() => {})}>
                {connected ? t.controls.disconnect : t.controls.connect}
              </button>
              <button className="secondary-action" type="button" onClick={micRef.current ? stopMic : startMic}>
                <span className={micLive ? "action-dot action-dot-on" : "action-dot"} />
                {micRef.current ? t.controls.stopMic : t.controls.startMic}
              </button>
              <button className="weak-action" type="button" onClick={clearConversation}>
                {t.controls.clearHistory}
              </button>
              {error ? (
                <div className="side-alert side-alert-error">
                  <strong>{t.alerts.connection}</strong>
                  <span>{error}</span>
                </div>
              ) : null}
              {!localAudio.secureContext || !localAudio.available ? (
                <div className="side-alert">
                  <strong>{t.alerts.browserAudio}</strong>
                  <span>{t.alerts.browserAudioDetail}</span>
                </div>
              ) : null}
            </section>

            <section className="side-panel devices-panel">
              <p>{t.devices.title}</p>
              <div className="device-row">
                <span>{t.devices.input}</span>
                <strong>{inputDeviceLabel}</strong>
              </div>
              <div className="device-row">
                <span>{t.devices.output}</span>
                <strong>{outputDeviceLabel}</strong>
              </div>
            </section>

            <section className="side-panel instructions-panel">
              <div className="side-head-row">
                <div>
                  <p>{t.instructions.kicker}</p>
                  <h2>{t.instructions.title}</h2>
                </div>
                <span>{t.instructions.tag}</span>
              </div>
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={6} />
            </section>

            <section className="collapse-panel">
              <button type="button" onClick={() => setShowAdvanced((value) => !value)}>
                <span>{t.advanced.title}</span>
                <span>{showAdvanced ? t.advanced.collapse : t.advanced.expand}</span>
              </button>
              {showAdvanced ? (
                <div className="collapse-body">
                  <label>
                    <span>{t.advanced.remoteUrl}</span>
                    <input value={displayServerUrl || serverUrl} readOnly spellCheck="false" />
                  </label>
                  <label>
                    <span>{t.advanced.browserUrl}</span>
                    <input value={serverUrl} readOnly spellCheck="false" />
                  </label>
                  <div className="setting-row">
                    <span>{t.advanced.sampleRate}</span>
                    <strong className="mono">{TARGET_SAMPLE_RATE} Hz</strong>
                  </div>
                  <div className="setting-row">
                    <span>{t.advanced.transport}</span>
                    <strong>{t.advanced.transportValue}</strong>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="collapse-panel">
              <button type="button" onClick={() => setShowLog((value) => !value)}>
                <span>
                  {t.log.title} <strong>{events.length}</strong>
                </span>
                <span>{showLog ? t.advanced.collapse : t.advanced.expand}</span>
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
                    <div className="log-empty">{t.log.empty}</div>
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
