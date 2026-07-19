# 阿里云 TTS 实测报告

- 时间: 2026-03-01T15:06:09.049772
- API: DashScope

## 该 Key 当前可见 TTS/语音相关模型

- `qwen3-tts-vd-2026-01-26`
- `qwen3-tts-instruct-flash-2026-01-26`
- `qwen3-tts-instruct-flash`
- `qwen3-tts-vc-2026-01-22`
- `qwen3-tts-instruct-flash-realtime-2026-01-22`
- `qwen3-tts-instruct-flash-realtime`
- `qwen3-tts-vd-realtime-2026-01-15`
- `qwen3-tts-vc-realtime-2026-01-15`
- `qwen3-tts-vd-realtime-2025-12-16`
- `qwen3-tts-vc-realtime-2025-11-27`
- `qwen3-tts-flash-2025-11-27`
- `qwen3-tts-flash-realtime-2025-11-27`
- `qwen3-tts-flash`
- `qwen3-tts-flash-2025-09-18`
- `qwen3-tts-flash-realtime-2025-09-18`
- `qwen3-tts-flash-realtime`
- `qwen-tts-2025-05-22`

## 本地试听结果

- [system] `Cherry` / 女声-悬疑讲述 / ok / `01_Cherry.wav`
- [system] `Chelsie` / 女声-温柔叙述 / ok / `02_Chelsie.wav`
- [system] `Serena` / 女声-知性纪录片 / ok / `03_Serena.wav`
- [system] `Ethan` / 男声-低沉悬疑 / ok / `04_Ethan.wav`
- [system] `Dylan` / 男声-电影预告感 / failed / ``
- [system] `Jada` / 女声-短视频口播 / failed / ``
- [system] `Sunny` / 中性-年轻感 / failed / ``
- [custom] `voiceA1` / 悬疑女声-冷静 / ok / `custom_01_voiceA1.wav`
- [custom] `voiceA2` / 悬疑男声-低沉 / ok / `custom_02_voiceA2.wav`
- [custom] `voiceA3` / 知性女声-纪录片 / ok / `custom_03_voiceA3.wav`
- [custom] `voiceA4` / 年轻中性-短视频 / ok / `custom_04_voiceA4.wav`
- [custom] `voiceA5` / 成熟女声-情绪推进 / ok / `custom_05_voiceA5.wav`
- [custom] `voiceA6` / 成熟男声-电影预告 / ok / `custom_06_voiceA6.wav`

## 备注

- `qwen3-tts-instruct-flash` 实测可用系统音色: Cherry / Chelsie / Serena / Ethan。
- 实测 `Dylan/Jada/Sunny` 在该模型下返回 InvalidParameter: Voice is not supported。
- 自定义音色通过 `qwen-voice-design` 生成 preview 音频，可用于听音色方向。