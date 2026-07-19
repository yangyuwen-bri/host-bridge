const DATASET = window.ZHIGUAI_DATASET || [];
const PAGE_SIZE = 30;

const state = {
  collection: "全部",
  volume: "全部",
  search: "",
  sort: "storyId",
  page: 1,
  activeStoryId: DATASET[0]?.storyId ?? null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCollections() {
  return ["全部", ...new Set(DATASET.map((item) => item.collection))];
}

function getVolumes(collection) {
  const base = collection === "全部" ? DATASET : DATASET.filter((item) => item.collection === collection);
  return ["全部", ...new Set(base.map((item) => item.volume))];
}

function compareText(a, b) {
  return a.localeCompare(b, "zh-Hans-CN-u-co-pinyin");
}

function getFilteredStories() {
  const keyword = state.search.trim().toLowerCase();

  const filtered = DATASET.filter((item) => {
    const matchCollection = state.collection === "全部" || item.collection === state.collection;
    const matchVolume = state.volume === "全部" || item.volume === state.volume;
    const text = `${item.storyId} ${item.title} ${item.storyText}`.toLowerCase();
    const matchSearch = keyword === "" || text.includes(keyword);
    return matchCollection && matchVolume && matchSearch;
  });

  filtered.sort((left, right) => {
    if (state.sort === "title") return compareText(left.title, right.title);
    if (state.sort === "charCountDesc") return right.charCount - left.charCount || compareText(left.storyId, right.storyId);
    if (state.sort === "charCountAsc") return left.charCount - right.charCount || compareText(left.storyId, right.storyId);
    return compareText(left.storyId, right.storyId);
  });

  return filtered;
}

function groupedCounts(items, key) {
  const counts = new Map();
  items.forEach((item) => counts.set(item[key], (counts.get(item[key]) || 0) + 1));
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, ratio: Number(((count / items.length) * 100).toFixed(1)) }))
    .sort((left, right) => right.count - left.count || compareText(left.name, right.name));
}

function excerpt(text, max = 110) {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function escapeCsv(value) {
  const normalized = String(value ?? "");
  if (normalized.includes('"') || normalized.includes(",") || normalized.includes("\n")) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }
  return normalized;
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderCollectionChips() {
  const root = document.getElementById("collection-chips");
  root.innerHTML = getCollections()
    .map(
      (collection) => `
        <button
          class="chip-btn ${collection === state.collection ? "active" : ""}"
          data-collection="${collection}"
        >
          ${collection}
        </button>
      `,
    )
    .join("");

  root.querySelectorAll("[data-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      state.collection = button.getAttribute("data-collection");
      state.volume = "全部";
      state.page = 1;
      syncControls();
      render();
    });
  });
}

function syncControls() {
  const volumeSelect = document.getElementById("volume-select");
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");
  const volumes = getVolumes(state.collection);

  if (!volumes.includes(state.volume)) state.volume = "全部";

  volumeSelect.innerHTML = volumes.map((volume) => `<option value="${volume}">${volume}</option>`).join("");
  volumeSelect.value = state.volume;
  searchInput.value = state.search;
  sortSelect.value = state.sort;
}

function renderSummary(filtered) {
  const collections = new Set(filtered.map((item) => item.collection)).size;
  const volumes = new Set(filtered.map((item) => item.volume)).size;
  const averageChars = filtered.length
    ? Math.round(filtered.reduce((sum, item) => sum + item.charCount, 0) / filtered.length)
    : 0;

  const cards = [
    { label: "当前样本数", value: formatNumber(filtered.length), sub: `全量 ${formatNumber(DATASET.length)}` },
    { label: "当前书系数", value: collections, sub: state.collection === "全部" ? "未锁定单一书系" : state.collection },
    { label: "当前分卷数", value: volumes, sub: state.volume === "全部" ? "覆盖多个分卷" : state.volume },
    { label: "平均篇幅", value: formatNumber(averageChars), sub: "按中文字符数估算" },
  ];

  document.getElementById("summary-grid").innerHTML = cards
    .map(
      (item) => `
        <article class="summary-card">
          <div class="label">${escapeHtml(item.label)}</div>
          <div class="value">${escapeHtml(item.value)}</div>
          <div class="sub">${escapeHtml(item.sub)}</div>
        </article>
      `,
    )
    .join("");
}

function renderOverview(filtered) {
  const familyRoot = document.getElementById("family-grid");
  const volumeRoot = document.getElementById("volume-list");
  const families = groupedCounts(filtered, "collection");
  const volumes = groupedCounts(filtered, "volume").slice(0, 18);

  familyRoot.innerHTML = families
    .map(
      (item) => `
        <article class="family-card">
          <div class="family-top">
            <div>
              <div class="family-name">${escapeHtml(item.name)}</div>
              <div class="family-count">${formatNumber(item.count)}</div>
            </div>
            <div class="story-meta">${item.ratio}%</div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${Math.max(item.ratio, 2)}%"></div></div>
        </article>
      `,
    )
    .join("");

  volumeRoot.innerHTML = volumes
    .map(
      (item) => `
        <div class="volume-item">
          <div class="volume-row">
            <div class="volume-name">${escapeHtml(item.name)}</div>
            <div class="volume-meta">${formatNumber(item.count)} 篇 / ${item.ratio}%</div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${Math.max(item.ratio, 2)}%"></div></div>
        </div>
      `,
    )
    .join("");
}

function ensureActiveStory(filtered) {
  if (!filtered.some((item) => item.storyId === state.activeStoryId)) {
    state.activeStoryId = filtered[0]?.storyId ?? null;
  }
}

function renderStories(filtered) {
  ensureActiveStory(filtered);

  const start = (state.page - 1) * PAGE_SIZE;
  const pageStories = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const storyRoot = document.getElementById("story-list");
  const paginationRoot = document.getElementById("pagination");

  storyRoot.innerHTML = pageStories
    .map(
      (item) => `
        <article class="story-card ${item.storyId === state.activeStoryId ? "active" : ""}" data-story-id="${item.storyId}">
          <div class="story-head">
            <div>
              <div class="story-title">${escapeHtml(item.title)}</div>
              <div class="story-id">${escapeHtml(item.storyId)}</div>
            </div>
            <div class="story-meta">${formatNumber(item.charCount)} 字</div>
          </div>
          <div class="story-meta">
            <span>${escapeHtml(item.collection)}</span>
            <span>${escapeHtml(item.volume)}</span>
            <span>${escapeHtml(item.localTextPath || "")}</span>
          </div>
          <div class="story-excerpt">${escapeHtml(excerpt(item.storyText))}</div>
          <div class="story-actions">
            <a class="story-link" href="${item.originalTextLink}" target="_blank" rel="noopener noreferrer">原文</a>
            ${
              item.sourceVolumeUrl
                ? `<a class="story-link secondary" href="${item.sourceVolumeUrl}" target="_blank" rel="noopener noreferrer">来源页</a>`
                : ""
            }
          </div>
        </article>
      `,
    )
    .join("");

  storyRoot.querySelectorAll("[data-story-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeStoryId = card.getAttribute("data-story-id");
      renderStories(filtered);
      renderDetail(filtered);
    });
  });

  storyRoot.querySelectorAll(".story-link").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  paginationRoot.innerHTML = `
    <button class="page-btn" id="prev-page" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
    <div class="page-indicator">第 ${state.page} / ${totalPages} 页，共 ${formatNumber(filtered.length)} 篇</div>
    <button class="page-btn" id="next-page" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>
  `;

  paginationRoot.querySelector("#prev-page").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderStories(filtered);
    }
  });

  paginationRoot.querySelector("#next-page").addEventListener("click", () => {
    if (state.page < totalPages) {
      state.page += 1;
      renderStories(filtered);
    }
  });
}

function renderDetail(filtered) {
  const story = filtered.find((item) => item.storyId === state.activeStoryId);
  const title = document.getElementById("detail-title");
  const meta = document.getElementById("detail-meta");
  const text = document.getElementById("detail-text");
  const actions = document.getElementById("detail-actions");

  if (!story) {
    title.textContent = "当前筛选下没有故事";
    meta.textContent = "请调整筛选条件";
    actions.innerHTML = "";
    text.textContent = "当前没有可展示的故事全文。";
    return;
  }

  title.textContent = story.title;
  meta.textContent = `${story.storyId} · ${story.collection} · ${story.volume} · ${formatNumber(story.charCount)} 字`;
  actions.innerHTML = `
    <a class="detail-link" href="${story.originalTextLink}" target="_blank" rel="noopener noreferrer">打开本地原文</a>
    ${
      story.sourceVolumeUrl
        ? `<a class="detail-link secondary" href="${story.sourceVolumeUrl}" target="_blank" rel="noopener noreferrer">打开来源页</a>`
        : ""
    }
  `;
  text.textContent = story.storyText;
}

function bindControls() {
  document.getElementById("volume-select").addEventListener("change", (event) => {
    state.volume = event.target.value;
    state.page = 1;
    render();
  });

  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.page = 1;
    render();
  });

  document.getElementById("sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    render();
  });

  document.getElementById("reset-button").addEventListener("click", () => {
    state.collection = "全部";
    state.volume = "全部";
    state.search = "";
    state.sort = "storyId";
    state.page = 1;
    state.activeStoryId = DATASET[0]?.storyId ?? null;
    render();
  });

  document.getElementById("export-json-button").addEventListener("click", () => {
    const filtered = getFilteredStories();
    downloadText(
      "zhiguai-filtered-stories.json",
      `${JSON.stringify(filtered, null, 2)}\n`,
      "application/json;charset=utf-8",
    );
  });

  document.getElementById("export-csv-button").addEventListener("click", () => {
    const filtered = getFilteredStories();
    const header = [
      "storyId",
      "title",
      "collection",
      "volume",
      "charCount",
      "localTextPath",
      "originalTextLink",
      "originalTextFileUrl",
      "sourceVolumeUrl",
      "sourceAnchor",
      "sourcePageTitle",
      "storyText",
    ];
    const lines = [
      header.join(","),
      ...filtered.map((item) =>
        header
          .map((field) => escapeCsv(item[field] ?? ""))
          .join(","),
      ),
    ];
    downloadText("zhiguai-filtered-stories.csv", `${lines.join("\n")}\n`, "text/csv;charset=utf-8");
  });
}

function renderMeta(filtered) {
  const meta = [];
  meta.push(state.collection === "全部" ? "全部书系" : state.collection);
  meta.push(state.volume === "全部" ? "全部分卷" : state.volume);
  if (state.search.trim()) meta.push(`关键词：${state.search.trim()}`);
  document.getElementById("result-meta").textContent = `${meta.join(" / ")} · 命中 ${formatNumber(filtered.length)} 篇`;
}

function render() {
  syncControls();
  renderCollectionChips();
  const filtered = getFilteredStories();
  if (state.page > Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))) state.page = 1;
  renderMeta(filtered);
  renderSummary(filtered);
  renderOverview(filtered);
  renderStories(filtered);
  renderDetail(filtered);
}

document.getElementById("dataset-path").textContent =
  "/Users/gsdata/waoowaoo-main/materials/zhiguai/analysis/llm_runs/20260322-173921-full-gpt-claude-1517/stories.json";

bindControls();
render();
