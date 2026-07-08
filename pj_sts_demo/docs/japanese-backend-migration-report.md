# 后端日语化改造分析报告

本文档基于 `jp_backend_ref.txt`、当前后端部署脚本，以及官方 `huggingface/speech-to-speech` 项目文档整理。本文只描述建议变更，不直接进行代码修改或部署操作。

## 结论

当前后端仍是英语/默认倾向配置，核心问题在 STT：

- 当前使用 `--stt parakeet-tdt`
- 官方文档说明 Parakeet TDT 是默认 STT，但多语言支持表里标注它覆盖的是 25 个欧洲语言；日语应切到 Whisper / Faster Whisper 这类多语言 STT。
- 官方也明确单语言模式应设置 `--language <target>`，日语应使用 `--language ja`。
- TTS 当前用 `qwen3`，官方说明 Qwen3-TTS 是多语言，且默认 `--qwen3_tts_language auto`，可显式改成 `--qwen3_tts_language ja`。

官方依据：

- speech-to-speech 是 `VAD -> STT -> LLM -> TTS` 模块化管线，各组件可用 CLI flags 替换。
- 官方支持 STT 后端包括 Parakeet、Whisper、Faster Whisper 等；Faster Whisper 需安装 `speech-to-speech[faster-whisper]`。
- 官方多语言说明：语言覆盖取决于 STT/TTS 后端；单语言用 `--language`，默认是 `en`。
- 官方实时服务暴露 `/v1/realtime` WebSocket。

参考来源：[huggingface/speech-to-speech README](https://github.com/huggingface/speech-to-speech)

## 当前本地脚本状态

需要关注两个文件：

- `backend/start_realtime.sh`
- `backend/deploy_pj_sts_demo.py`

### `backend/start_realtime.sh`

当前核心启动段是：

```bash
--stt parakeet-tdt
--llm_backend responses-api
--tts qwen3
--qwen3_tts_backend torch
--model_name qwen35b
--responses_api_base_url http://localhost:8000/v1
```

### `backend/deploy_pj_sts_demo.py`

它生成的 `run_local_llm.sh` 里也仍然使用：

```bash
--stt parakeet-tdt
--tts qwen3
```

所以如果只改远端 `start_realtime.sh`，以后重新 deploy 可能又被部署脚本生成的默认配置覆盖。日语化应该同时规划这两个入口。

## 建议目标配置

最低风险日语化配置：

```bash
speech-to-speech \
  --mode realtime \
  --ws_host "$BACKEND_WS_HOST" \
  --ws_port "$BACKEND_WS_PORT" \
  --stt faster-whisper \
  --stt_model_name large-v3-turbo \
  --language ja \
  --llm_backend responses-api \
  --tts qwen3 \
  --qwen3_tts_language ja \
  --qwen3_tts_backend torch \
  --model_name qwen35b \
  --responses_api_base_url http://localhost:8000/v1 \
  --responses_api_api_key not-needed \
  --responses_api_stream \
  --enable_live_transcription
```

如果实际 CLI 不接受 `--stt_model_name large-v3-turbo`，按官方说明 STT 参数是 handler prefix 形式，也可能需要改成具体 Faster Whisper handler 暴露的参数名。最终应在远端执行：

```bash
speech-to-speech -h | grep -i whisper
```

确认准确参数名。

## 依赖变化

因为建议使用 Faster Whisper，远端安装不应只是：

```bash
pip install -e .
```

而应考虑：

```bash
pip install -e ".[faster-whisper]"
```

官方 README 明确 Faster Whisper 是 optional backend，需要 `speech-to-speech[faster-whisper]`。

## VAD 建议

日语会话里「はい」「うん」「ええ」这类相槌很多，过短语音不应轻易触发打断。参考 `jp_backend_ref.txt`，建议后续实测：

```bash
--min_speech_ms 550
--short_segment_merge_ms 200
```

但这属于调参项，不建议第一次日语化就和 STT/TTS 一起大改。建议第一阶段只切 STT/TTS/language，确认链路可用后再调 VAD。

## LLM 层建议

你现在使用 `qwen35b` alias，接 llama.cpp/OpenAI-compatible endpoint。架构上不用变，但 system prompt 应调整为日语：

```text
あなたは簡潔で自然な日本語で話す音声アシスタントです。
丁寧語（です・ます調）で、短く分かりやすく答えてください。
必要がない限り長い説明は避けてください。
```

如果 Qwen 系模型出现中文混入，后续可考虑日语强化模型或在 TTS 前做文本过滤，但这不是第一阶段必须项。

## 分阶段改造计划

### 第一阶段：只改启动参数

- `--stt parakeet-tdt` 改为 Faster Whisper
- 增加 `--language ja`
- 增加 `--qwen3_tts_language ja`
- 安装 Faster Whisper extra
- 日语 system prompt

### 第二阶段：稳定性调参

- `--min_speech_ms 500-600`
- `--short_segment_merge_ms 150-250`
- 观察相槌是否误打断

### 第三阶段：质量优化

- 日语 LLM 模型评估
- 日语分句逻辑
- 数字、日期、英文缩写的日语读法规范化

## 风险点

- Faster Whisper 参数名需要以远端 `speech-to-speech -h` 为准。
- `large-v3-turbo` 首次加载会下载模型，远端网络和磁盘要确认。
- WSS/nginx 与 `/v1/realtime` 路径无关，不需要因日语化改动。
- 如果后续使用 `deploy_pj_sts_demo.py` 重新部署，要同步更新它生成的 `run_local_llm.sh`，否则会回到 `parakeet-tdt`。

## 推荐下一步

先不要直接改代码。建议下一步生成“变更方案 diff 草案”，只输出拟修改片段，不实际 apply。这样可以先确认 `start_realtime.sh` 和 `deploy_pj_sts_demo.py` 两处应该如何一致地日语化。
