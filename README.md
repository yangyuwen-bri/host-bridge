# Host Bridge

热点故事编辑台：从当日社会热点、完整志怪素材库和大模型匹配开始，经过主播开场、视频号文案、阿里云成片生成，形成可发布的故事视频。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000/story-studio`。

## 内容边界

- 热点检索、议题提炼和素材匹配由大模型完成，不使用关键词硬匹配。
- 主播开场和视频号文案在故事确认后独立生成。
- 视频、音频、字幕和本地运行态不进入 Git，成片由发布清单索引。
- 阿里云视频生成脚本保留在 `scripts/`，远程存储 provider 通过配置接入。
