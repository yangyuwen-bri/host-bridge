#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = "/Users/gsdata/waoowaoo-main/materials/zhiguai";
const STORIES_PATH = path.join(
  ROOT,
  "analysis",
  "llm_runs",
  "20260322-173921-full-gpt-claude-1517",
  "stories.json",
);
const OUT_DIR = path.join(ROOT, "analysis", "standalone_annotation_report");
const OUT_JS = path.join(OUT_DIR, "dataset.js");
const OUT_JSON = path.join(OUT_DIR, "dataset.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildRecord(story) {
  const metaPath = path.join(ROOT, "stories", story.story_id, "meta.json");
  const meta = fs.existsSync(metaPath) ? readJson(metaPath) : {};
  const localTextPath = meta.local_text_path || `stories/${story.story_id}/source.txt`;

  return {
    storyId: story.story_id,
    title: story.title,
    collection: story.collection,
    volume: story.volume,
    storyText: story.story_text,
    charCount: story.story_text.length,
    sourceVolumeUrl: meta.source_volume_url || "",
    sourceAnchor: meta.story_anchor || "",
    sourcePageTitle: meta.source_page_title || "",
    localTextPath,
    originalTextLink: `../../${localTextPath}`,
    originalTextFileUrl: `file://${path.join(ROOT, localTextPath)}`,
  };
}

function main() {
  const stories = readJson(STORIES_PATH);
  const dataset = stories.map(buildRecord);

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT_JS, `window.ZHIGUAI_DATASET = ${JSON.stringify(dataset, null, 2)};\n`, "utf8");

  console.log(`dataset written: ${dataset.length} stories`);
}

main();
