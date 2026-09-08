/* Review-only local interactions. No native calls, network, or durable storage. */
(() => {
  const paths = {
    library: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="15" width="7" height="7" rx="1"/><rect x="14" y="15" width="7" height="7" rx="1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    model: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    location: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    prop: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10"/>',
    clothing: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 4-8 4-8 0Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    star: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    save: '<path d="M20 12v8H4v-8M12 3v12m-4-4 4 4 4-4"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    folder: '<path d="M3 6h7l2 3h9v12H3V6Z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  };
  const icon = (name) => `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.library}</svg>`;
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const kinds = { imageGroup: ["图片组", "image"], modelCard: ["模特", "model"], shootingLocation: ["场地", "location"], prop: ["道具", "prop"], clothing: ["服装", "clothing"] };
  const seed = [
    { id: "demo-01", kind: "shootingLocation", name: "霓虹街角 · 蓝调夜景", title: "霓虹街角", text: "场地信息\n示例街区 · 临街骑楼\n雨后地面有反光，蓝调时刻适合拍摄。\n建议携带小型补光灯，避开车流。", tags: ["夜景", "霓虹", "街拍"], description: "适合蓝调时刻与雨后街拍。文字、图片和裁切位置一起复用，不必重复整理。", images: 2, size: "4.8 MB", art: "night", favorite: true, updated: 9 },
    { id: "demo-02", kind: "modelCard", name: "清冷风 · 模特示例 A", title: "模特示例 A", text: "模特信息\n身高 172 cm　体重 52 kg\n鞋码 38\n\n其他信息\n短发，适合简洁轮廓与黑白造型。\n以上均为虚构演示信息。", tags: ["清冷", "棚拍"], description: "保留模特的基础信息、其他信息与样片。素材名称仅用于在库内查找。", images: 2, size: "6.2 MB", art: "portrait", favorite: false, updated: 8 },
    { id: "demo-03", kind: "imageGroup", name: "复古窗光 · 情绪参考", title: "窗边的下午", text: "参考说明\n暖色侧光，低饱和背景。保留人物周围的呼吸空间。", tags: ["复古", "窗光", "人像"], description: "整个图片组的说明、图片顺序、每张图的尺寸和裁切位置都会保存。", images: 3, size: "8.1 MB", art: "window", favorite: true, updated: 7 },
    { id: "demo-04", kind: "prop", name: "透明玻璃 · 静物道具", title: "透明玻璃与花枝", text: "道具信息\n透明玻璃杯、细口花瓶与干燥花枝。\n准备浅灰背景纸，侧后方打光突出轮廓。", tags: ["静物", "玻璃"], description: "适合清透、安静的静物画面，可搭配浅灰背景纸。", images: 2, size: "3.4 MB", art: "still", favorite: false, updated: 6 },
    { id: "demo-05", kind: "clothing", name: "米白针织 · 秋日穿搭", title: "米白针织套装", text: "服装信息\n宽松针织开衫与同色系长裙。\n参考色：奶油白、浅棕。\n避免大面积标志与高饱和配饰。", tags: ["秋日", "米白"], description: "建议纳入首版的第五种素材。仅保存服装信息与主图库，不恢复试穿参考。", images: 2, size: "5.6 MB", art: "clothes", favorite: false, updated: 5 },
    { id: "demo-06", kind: "shootingLocation", name: "白墙工作室 · 自然光", title: "白墙工作室", text: "场地信息\n示例摄影空间 · 二层\n朝南大窗，下午自然光充足。\n白墙与木地板适合轻量布景。", tags: ["室内", "自然光"], description: "简洁的白墙与自然光，适合人像、服装和静物。", images: 2, size: "4.1 MB", art: "studio", favorite: false, updated: 4 },
  ];
  let materials = structuredClone(seed);
  let selectedId = materials[0].id;
  let filter = "all";
  let query = "";
  let scenario = "normal";
  let mode = "insert";
  let sort = "relevance";
  let formMode = "save";
  let formSource = null;
  let busy = false;
  let sequence = 20;
  let composing = false;
  let searchTimer;
  let previewObserver;
  let inserted = [];
  const focusOrigins = new WeakMap();
  const selected = () => materials.find((item) => item.id === selectedId);
  const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();

  function scene(art, alternate = false) {
    const shift = alternate ? 35 : 0;
    let drawing;
    if (art === "night") {
      drawing = `<rect width="180" height="220" fill="${alternate ? "#203848" : "#243141"}"/><rect x="0" y="123" width="180" height="97" fill="#27303f"/><path d="m0 170 85-50 95 48v52H0" fill="#344553"/><path d="m65 138-30 82M110 138l55 82" stroke="#667776" opacity=".5"/><rect x="9" y="20" width="65" height="122" fill="#44404b"/><rect x="107" y="6" width="73" height="147" fill="#192b39"/><rect x="17" y="35" width="19" height="55" fill="#dc6882"/><rect x="23" y="40" width="7" height="44" fill="#f5abb9"/><rect x="117" y="31" width="42" height="8" fill="#6fc0c9"/><rect x="116" y="59" width="22" height="55" fill="#599aab"/><path d="M57 104h21v25H57" fill="#d2a87c"/><path d="m23 168 18 4-5 40H15M128 176l19-3 20 47h-30" fill="#ae6581" opacity=".33"/><circle cx="${88 + shift / 3}" cy="140" r="5" fill="#c1bab2"/><path d="m85 145-4 23h15l-4-23" fill="#17232c"/><path d="M84 166v17m8-17 2 17" stroke="#111f2b" stroke-width="4"/>`;
    } else if (art === "portrait" || art === "clothes") {
      const clothing = art === "clothes";
      drawing = `<rect width="180" height="220" fill="${clothing ? "#c8c0ad" : "#879797"}"/><path d="M0 0h70L20 220H0" fill="#dce0d7" opacity=".45"/><ellipse cx="100" cy="219" rx="54" ry="10" fill="#273333" opacity=".16"/><path d="m68 83-24 19-8 64 22 2 12-40-1 92h63l-3-92 13 39 20-8-19-59-22-17" fill="${clothing ? "#efe7d4" : "#343d42"}"/><path d="m83 70-2 22 20 16 15-18-8-20" fill="#c1a58f"/><ellipse cx="${96 + shift / 8}" cy="49" rx="23" ry="31" fill="#d2b7a0"/><path d="M72 58c-18-61 66-67 52 1l-13-34-32 9Z" fill="#353535"/><path d="M86 51h5m15 0h5" stroke="#67564d" stroke-width="2"/><path d="M94 67h12" stroke="#a08073" stroke-width="2"/><path d="m84 100 14 25 19-26M98 125v95" fill="none" stroke="${clothing ? "#c9beab" : "#677477"}"/>`;
    } else if (art === "still") {
      drawing = `<rect width="180" height="220" fill="#c5ceca"/><path d="M0 154h180v66H0" fill="#d8d9c8"/><ellipse cx="98" cy="183" rx="63" ry="10" fill="#89968f" opacity=".4"/><path d="m89 101-6 61c-2 25 49 25 47 0l-7-61Z" fill="#edf5ed" fill-opacity=".45" stroke="#f5f6e9" stroke-width="2"/><path d="m108 132-6-95m7 64 35-48m-41 20L77 53" stroke="#746c50" stroke-width="2"/><ellipse cx="144" cy="47" rx="9" ry="17" fill="#ad986e" transform="rotate(32 144 47)"/><ellipse cx="99" cy="32" rx="8" ry="16" fill="#a9916b"/><ellipse cx="74" cy="50" rx="8" ry="13" fill="#b6a580" transform="rotate(-40 74 50)"/><path d="m26 129 4 49h37l4-49Z" fill="#d5e5df" fill-opacity=".55" stroke="#f1f4ea" stroke-width="2"/><ellipse cx="49" cy="129" rx="23" ry="5" fill="none" stroke="#f6f5e8"/>`;
    } else {
      drawing = `<rect width="180" height="220" fill="${art === "studio" ? "#d9d9cb" : "#bdb098"}"/><rect x="${18 + shift}" y="17" width="74" height="117" fill="#f0ead5"/><path d="M55 17v117M18 71h74" stroke="#a59e8b" stroke-width="5"/><path d="m20 135 111 0 49 85H67" fill="#f4e9cb" opacity=".6"/><path d="M0 154h180v66H0" fill="#a79a7d" opacity=".35"/><rect x="99" y="140" width="44" height="13" rx="4" fill="#766c5c"/><path d="m104 153-5 52m39-52 8 52" stroke="#736652" stroke-width="6"/><path d="M25 168h23v40H25" fill="#999779"/><path d="m36 171-9-61m9 41 22-31" stroke="#697862" stroke-width="3"/><ellipse cx="27" cy="108" rx="9" ry="18" fill="#7e8c75" transform="rotate(-25 27 108)"/>`;
    }
    return `<svg class="scene" role="img" aria-label="本地绘制的虚构素材示意图" viewBox="0 0 180 220" preserveAspectRatio="xMidYMid slice">${drawing}</svg>`;
  }

  function component(item, mini = false, missing = false) {
    const [heading, ...body] = item.text.split("\n");
    return `<div class="component ${escapeHtml(item.kind)}${mini ? " mini" : ""}">
      <div class="component-head">${icon(kinds[item.kind][1])}<span>${escapeHtml(item.title)}</span></div>
      <div class="component-layout">
        <div class="component-info"><strong>${escapeHtml(heading)}</strong>${escapeHtml(body.join("\n"))}</div>
        ${missing ? '<div class="missing-image">图片副本缺失<br>恢复图片后才能插入</div>' : `<div class="component-gallery">${Array.from({ length: item.images }, (_, index) => scene(item.art, index % 2 === 1)).join("")}</div>`}
      </div>
    </div>`;
  }

  document.title = "Preshot · 全局素材库设计稿";
  document.querySelector("#app").innerHTML = `
    <div class="workspace">
      <header class="appbar row between"><div class="row"><span class="wordmark">preshot</span><span class="muted">/</span><span class="caption">摄影策划工作区</span></div><span class="prototype-note">设计审核稿 · 不连接真实项目或数据库</span><button class="icon ghost" data-action="theme" aria-label="切换明暗主题">${icon("moon")}</button></header>
      <nav class="rail" aria-label="工作区导航"><div class="eyebrow">WORKSPACE</div><button class="ghost" data-action="workspace">${icon("folder")}示例拍摄方案</button><button data-action="manage">${icon("library")}素材库</button><div class="rail-note">保留灵感，也保留细节。<br>在不同项目中复用自己的素材。</div></nav>
      <main class="workspace-main">
        <div class="document-toolbar row between wrap"><span class="caption muted">示例拍摄方案 / 策划文档</span><button class="primary" data-action="open-library">${icon("plus")}插入素材</button></div>
        <article class="document">
          <div class="eyebrow">SHOOTING PLAN / DEMO</div><h1>城市夜色 · 拍摄方案</h1><p class="document-intro">从熟悉的场景开始，为下一次拍摄留一点新的空间。</p>
          <div class="selected-paragraph" tabindex="0" id="insertion-anchor"><strong>拍摄说明</strong><p>计划在蓝调时刻拍摄一组街头人像，使用环境光与小型补光。<br>新素材将插入在这段说明之后，独占一行。</p></div>
          <div id="inserted-blocks"></div>
          <div class="source-label row between wrap"><span class="caption muted">当前组件 · 场地信息</span><button data-action="save-source">${icon("save")}保存到素材库</button></div>
          ${component(seed[0])}
          <p class="caption muted" style="margin-top:18px">实际产品中，“保存到素材库”位于组件右上角的更多菜单。此处展开显示，便于审核。</p>
        </article>
      </main>
    </div>
    <dialog class="library" id="library-dialog" aria-labelledby="library-heading">
      <div class="library-shell">
        <header class="library-header">
          <div class="library-title row between"><div class="row"><div class="library-icon">${icon("library")}</div><div><h2 id="library-heading">素材库</h2><p>保存自己的组件，在每一个项目里重新使用。</p></div></div><div class="row"><button class="icon ghost" data-action="theme" aria-label="切换明暗主题">${icon("moon")}</button><button class="icon ghost" data-close="library-dialog" aria-label="关闭素材库">${icon("close")}</button></div></div>
          <div class="search-row row">
            <div class="search-box"><label for="library-search" class="sr-only">搜索素材名称、标签和全部文字</label>${icon("search")}<input id="library-search" placeholder="搜索名称、标签或素材里的文字…" autocomplete="off" maxlength="128"><button class="icon ghost clear-search" data-action="clear-search" aria-label="清空搜索">${icon("close")}</button></div>
            <label class="sr-only" for="sort">排序方式</label><select id="sort"><option value="relevance">相关度优先</option><option value="recent">最近更新</option><option value="name">名称排序</option></select>
          </div>
        </header>
        <div class="library-body">
          <nav class="type-rail" aria-label="素材类型筛选"><div class="eyebrow">MY LIBRARY</div>${[["all", "全部素材", "library"], ...Object.entries(kinds).map(([key, value]) => [key, value[0], value[1]])].map(([key, label, symbol]) => `<button data-filter="${key}" aria-pressed="false">${icon(symbol)}${label}<span class="count" data-count="${key}"></span></button>`).join("")}<div class="divider"></div><button data-filter="favorite" aria-pressed="false">${icon("star")}收藏<span class="count" data-count="favorite"></span></button><button data-filter="trash" aria-pressed="false">${icon("trash")}回收站<span class="count" data-count="trash"></span></button></nav>
          <section class="results-panel" aria-label="素材搜索结果"><div class="results-heading row between"><span id="result-count" role="status" aria-live="polite"></span><span class="muted">本机 · 跨项目</span></div><div id="result-banner"></div><div id="results" class="result-grid"></div></section>
          <aside class="details" id="detail" aria-label="所选素材详情"></aside>
        </div>
        <footer class="library-footer"><div class="row between"><div class="destination" id="destination"></div><div class="row"><button data-close="library-dialog">取消</button><button class="primary" id="insert-button" data-action="insert">${icon("plus")}插入到文档</button></div></div><p class="inline-feedback" id="library-feedback" role="status" hidden></p></footer>
        <div class="review-bar row between"><div class="row"><span class="badge">交互稿</span><span class="review-explanation muted">数据仅保留在本页，刷新重置 · 示意图非真实照片</span></div><div class="row"><label for="scenario">状态演示</label><select id="scenario"><option value="normal">正常</option><option value="empty">素材库为空</option><option value="loading">加载中</option><option value="missing">原图副本缺失</option><option value="index">索引重建中</option><option value="storage">数据库不可用</option></select></div></div>
      </div>
    </dialog>
    <dialog class="form-dialog" id="save-dialog" aria-labelledby="save-heading">
      <form id="material-form" novalidate>
        <header class="dialog-heading row between"><div><h2 id="save-heading">保存到素材库</h2><p id="save-subheading">给这份素材取个名字，下次拍摄直接插入。</p></div><button type="button" class="icon ghost" data-close="save-dialog" aria-label="关闭保存窗口">${icon("close")}</button></header>
        <div class="form-body"><aside class="form-preview" id="save-preview"></aside>
          <div class="stack"><label class="field" for="material-name"><span>素材名称 <b class="required">*</b></span><input id="material-name" autocomplete="off" aria-describedby="name-hint name-error duplicate-warning"><small id="name-hint">仅用于素材库检索，不会修改组件内的标题。最多 80 字。</small></label>
          <p id="name-error" class="field-error" role="alert" hidden></p><p id="duplicate-warning" class="field-warning" hidden>已有同名素材，保存后会新增一份，不会覆盖。</p>
          <label class="field" for="material-tags"><span>标签 <small style="display:inline">选填</small></span><input id="material-tags" placeholder="例如：夜景，街拍，霓虹"><small>用逗号分隔，最多 12 个标签，每个最多 24 字。</small></label>
          <label class="field" for="material-description"><span>素材说明 <small style="display:inline">选填</small></span><textarea id="material-description" placeholder="记下适用场景，方便以后快速找到。" maxlength="1000"></textarea></label>
          <div class="ownership-note row">${icon("shield")}<span id="save-ownership">文字和图片都会保存独立副本。原项目删除后，素材仍可使用。</span></div>
          <p id="form-error" class="field-error" role="alert" hidden></p>
          </div>
        </div>
        <footer class="form-footer row between"><small id="save-progress" role="status">演示操作，不会写入磁盘</small><div class="row"><button type="button" data-close="save-dialog">取消</button><button type="submit" class="primary" id="save-submit">${icon("save")}保存素材</button></div></footer>
      </form>
    </dialog>
    <dialog class="full-preview-dialog" id="preview-dialog" aria-labelledby="preview-heading"><header class="dialog-heading row between"><div><h2 id="preview-heading">完整组件预览</h2><p>查看完整文字与图片 · 插入后仍可编辑</p></div><button class="icon ghost" data-close="preview-dialog" aria-label="关闭完整预览">${icon("close")}</button></header><div class="full-preview-body" id="full-preview"></div></dialog>
    <dialog class="confirm-dialog" id="delete-dialog" aria-labelledby="delete-heading"><h2 id="delete-heading">移入回收站？</h2><p id="delete-description"></p><div class="row" style="justify-content:flex-end"><button data-close="delete-dialog">取消</button><button class="danger" data-action="confirm-delete">移入回收站</button></div></dialog>
    <div class="toast" id="toast" role="status" hidden><span id="toast-text"></span><button id="toast-undo" hidden>撤销</button><button data-action="dismiss-toast" aria-label="关闭提示">关闭</button></div>`;

  const $ = (selector) => document.querySelector(selector);
  function openDialog(id, focusSelector) {
    const dialog = document.getElementById(id);
    focusOrigins.set(dialog, document.activeElement);
    dialog.showModal();
    (focusSelector ? dialog.querySelector(focusSelector) : dialog.querySelector("button"))?.focus();
  }
  function feedback(message) {
    $("#library-feedback").hidden = false;
    $("#library-feedback").textContent = message;
  }
  function toast(message, undo) {
    $("#toast-text").textContent = message;
    $("#toast").hidden = false;
    $("#toast-undo").hidden = !undo;
    $("#toast-undo").onclick = () => { undo(); $("#toast").hidden = true; };
  }
  function visibleMaterials() {
    if (["empty", "loading", "storage"].includes(scenario)) return [];
    const chunks = normalize(query).split(" ").filter(Boolean);
    return materials.filter((item) => {
      if (filter === "trash" ? !item.deleted : item.deleted) return false;
      if (filter === "favorite" && !item.favorite) return false;
      if (kinds[filter] && item.kind !== filter) return false;
      const fields = [item.name, item.title, item.text, item.description, item.tags.join(" "), kinds[item.kind][0]].map(normalize);
      return chunks.every((chunk) => fields.some((field) => field.includes(chunk)));
    }).sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id);
      if (sort === "relevance" && chunks.length) {
        const score = (item) => normalize(item.name) === normalize(query) ? 100 : chunks.reduce((sum, chunk) => sum + (normalize(item.name).includes(chunk) ? 8 : item.tags.some((tag) => normalize(tag).includes(chunk)) ? 5 : 1), 0);
        if (score(a) !== score(b)) return score(b) - score(a);
      }
      return b.updated - a.updated || a.id.localeCompare(b.id);
    });
  }
  function emptyState(title, text, action, actionLabel, symbol = "search") {
    return `<div class="empty-state"><div class="empty-icon">${icon(symbol)}</div><h3>${title}</h3><p>${text}</p>${action ? `<button data-action="${action}">${actionLabel}</button>` : ""}</div>`;
  }
  function renderLibrary() {
    const list = visibleMaterials();
    if (!list.some((item) => item.id === selectedId)) selectedId = list[0]?.id || null;
    document.querySelectorAll("[data-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === filter)));
    document.querySelectorAll("[data-count]").forEach((element) => {
      const key = element.dataset.count;
      element.textContent = scenario === "empty" ? "0" : String(materials.filter((item) => key === "trash" ? item.deleted : !item.deleted && (key === "all" || key === item.kind || key === "favorite" && item.favorite)).length);
    });
    $("#library-search").disabled = scenario === "index";
    $("#results").setAttribute("aria-busy", String(scenario === "loading"));
    $("#result-count").textContent = scenario === "loading" ? "正在加载素材…" : scenario === "storage" ? "读取未完成" : `${list.length} 份素材${query ? "匹配搜索" : ""}`;
    $("#result-banner").innerHTML = scenario === "index" ? '<div class="banner">正在重建中文检索索引。可以继续浏览，全文搜索暂不可用。</div>' : filter === "trash" ? '<div class="banner">删除的素材保留 30 天。恢复不会影响项目中的副本。</div>' : "";
    if (scenario === "loading") {
      $("#results").innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");
    } else if (scenario === "storage") {
      $("#results").innerHTML = emptyState("素材库暂时无法读取", "请检查磁盘是否可访问。不会把读取失败当成空素材库，也不会影响当前项目。", "retry", "重新读取", "folder");
    } else if (scenario === "empty") {
      $("#results").innerHTML = emptyState("把常用组件收进来", "在图片组或信息卡片的更多菜单中，选择“保存到素材库”。文字和图片一起保留。", "go-save", "试着保存当前组件", "library");
    } else if (!list.length) {
      $("#results").innerHTML = filter === "trash" ? emptyState("回收站是空的", "移入回收站不会影响已经插入项目的副本。", "", "", "trash") : emptyState("没有找到匹配的素材", "试试“夜景”“窗光”，或去掉一个筛选条件。可以搜索素材内部的文字。", "reset-filters", "清空搜索与筛选");
    } else {
      $("#results").innerHTML = list.map((item) => `<button class="material-card" data-select="${item.id}" aria-label="预览 ${escapeHtml(item.name)}" aria-pressed="${item.id === selectedId}">
        <div class="thumb" aria-hidden="true">${component(item, true)}</div><div class="card-copy"><h3>${escapeHtml(item.name)}</h3><div class="card-meta row">${kinds[item.kind][0]}<span>·</span>${item.images} 张图片<span class="selected-mark">${item.id === selectedId ? icon("check") : ""}</span></div><div class="card-tags row wrap">${item.tags.slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}${item.favorite ? '<span class="sr-only">已收藏</span>' : ""}</div></div></button>`).join("");
    }
    renderDetail();
  }
  function renderDetail() {
    previewObserver?.disconnect();
    const item = selected();
    const unavailable = !item || ["loading", "storage", "empty"].includes(scenario);
    $("#insert-button").hidden = mode === "manage";
    $("#insert-button").disabled = unavailable || scenario === "missing" || item?.deleted || busy;
    $("#destination").innerHTML = mode === "manage" ? '<strong>全局素材管理</strong><small>此处不插入文档。通过文档工具栏的“插入素材”选择位置。</small>' : '<strong>插入到「城市夜色 · 拍摄方案」</strong><small>位置：拍摄说明之后 · 独立副本，占据新的一行</small>';
    if (unavailable) {
      $("#detail").innerHTML = emptyState("先选一份素材", "这里会显示完整组件的预览，以及保存的文字和图片信息。", "", "", "image");
      return;
    }
    const missing = scenario === "missing";
    $("#detail").innerHTML = `<div class="row between"><span class="badge">${kinds[item.kind][0]}素材</span><button class="icon ghost" data-action="favorite" aria-label="${item.favorite ? "取消收藏" : "收藏素材"}" aria-pressed="${item.favorite}">${icon("star")}</button></div>
      <h3 style="margin-top:12px">${escapeHtml(item.name)}</h3><p class="detail-caption">${item.images} 张图片 · ${item.size} · 内容版本 1</p>
      <div class="row between"><span class="preview-label">组件整体预览</span><button class="small ghost" data-action="full-preview">${icon("expand")}完整预览</button></div>
      <div class="preview-stage"><div class="scaled-preview">${component(item, false, missing)}</div></div>
      <p class="caption muted" style="margin-bottom:18px">示意缩略图；生产版由已保存内容生成截图。</p>
      ${missing ? '<div class="banner error">有 1 张图片副本缺失。文字仍在，但恢复图片前不能插入。<button class="small" data-action="retry">重新检查</button></div>' : ""}
      <div class="stack"><div class="row wrap">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div><p class="detail-description">${escapeHtml(item.description)}</p>
      <dl class="detail-data"><div><dt>存储范围</dt><dd>当前用户的全部项目</dd></div><div><dt>图片保存方式</dt><dd>独立图片副本</dd></div></dl>
      <div class="ownership-note"><div class="row">${icon("shield")}<strong>插入副本，不建立关联</strong></div><p style="margin-top:5px">项目里的修改不影响素材库，删除素材也不影响已插入内容。</p></div>
      <div class="row wrap">${item.deleted ? '<button data-action="restore">' + icon("refresh") + '恢复素材</button>' : '<button class="small" data-action="edit-metadata">' + icon("edit") + '编辑名称与标签</button><button class="small ghost danger" data-action="delete">' + icon("trash") + '删除</button>'}</div></div>`;
    const preview = $("#detail .scaled-preview");
    const fitPreview = () => {
      const card = preview.firstElementChild;
      const scale = preview.clientWidth / 900;
      card.style.transform = `scale(${scale})`;
      preview.style.height = `${Math.ceil(card.offsetHeight * scale)}px`;
    };
    fitPreview();
    previewObserver = new ResizeObserver(fitPreview);
    previewObserver.observe(preview);
  }
  function openLibrary(manage = false) {
    mode = manage ? "manage" : "insert";
    $("#library-feedback").hidden = true;
    renderLibrary();
    openDialog("library-dialog", "#library-search");
  }
  function showSave(edit = false) {
    formMode = edit ? "edit" : "save";
    formSource = structuredClone(edit ? selected() : seed[0]);
    $("#save-heading").textContent = edit ? "编辑素材信息" : "保存到素材库";
    $("#save-subheading").textContent = edit ? "只修改素材库中的名称、标签与说明，不改变组件内容。" : "给这份素材取个名字，下次拍摄直接插入。";
    $("#material-name").value = formSource.name;
    $("#material-tags").value = formSource.tags.join("，");
    $("#material-description").value = formSource.description;
    $("#material-name").removeAttribute("aria-invalid");
    $("#name-error").hidden = true;
    $("#form-error").hidden = true;
    $("#save-progress").textContent = "演示操作，不会写入磁盘";
    $("#save-submit").innerHTML = icon("save") + (edit ? "保存修改" : "保存素材");
    $("#save-preview").innerHTML = `<span class="preview-label">${edit ? "已保存的组件" : "即将保存的组件"}</span>${component(formSource)}<p class="caption muted">${kinds[formSource.kind][0]} · ${formSource.images} 张图片 · ${formSource.size}</p><div class="divider" style="margin:15px 0"></div><p class="caption muted">组件内的全部可见文字、图片顺序、尺寸和裁切位置一起保留。</p>`;
    $("#save-ownership").textContent = edit ? "名称是展示信息，素材 ID 不变。已插入的项目副本不受影响。" : "文字和图片都会保存独立副本。原项目删除后，素材仍可使用。";
    updateDuplicateWarning();
    openDialog("save-dialog", "#material-name");
    $("#material-name").select();
  }
  function updateDuplicateWarning() {
    const name = normalize($("#material-name").value);
    $("#duplicate-warning").hidden = !materials.some((item) => !item.deleted && normalize(item.name) === name && (formMode !== "edit" || item.id !== formSource.id));
  }
  function renderInserted() {
    $("#inserted-blocks").innerHTML = inserted.map((item) => `<section class="inserted-card" tabindex="-1" data-instance="${item.instanceId}"><span class="badge">已插入独立副本 · ${escapeHtml(item.name)}</span>${component(item)}</section>`).join("");
  }
  function setBusy(value) {
    busy = value;
    $("#save-submit").disabled = value;
    document.querySelectorAll("#save-dialog [data-close]").forEach((button) => { button.disabled = value; });
  }

  document.addEventListener("compositionstart", () => { composing = true; });
  document.addEventListener("compositionend", () => { composing = false; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.isComposing || composing)) event.preventDefault();
    if (event.key !== "Tab") return;
    const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (!dialog) return;
    const targets = [...dialog.querySelectorAll('button, input, textarea, select, [tabindex="0"]')]
      .filter((element) => !element.disabled && !element.closest("[inert]") && element.getClientRects().length);
    const first = targets[0];
    const last = targets.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (!targets.includes(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  $("#library-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    if (composing) return;
    searchTimer = setTimeout(() => { query = $("#library-search").value; renderLibrary(); }, 180);
  });
  $("#library-search").addEventListener("compositionend", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = $("#library-search").value; renderLibrary(); }, 180);
  });
  $("#material-name").addEventListener("input", updateDuplicateWarning);
  $("#sort").addEventListener("change", (event) => { sort = event.target.value; renderLibrary(); });
  $("#scenario").addEventListener("change", (event) => {
    scenario = event.target.value;
    if (scenario === "index") { query = ""; $("#library-search").value = ""; }
    $("#library-feedback").hidden = true;
    renderLibrary();
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      const origin = focusOrigins.get(dialog);
      if (origin?.isConnected && !origin.closest("dialog:not([open])")) origin.focus();
      else if ($("#library-dialog").open) $("#library-search").focus();
      else $('[data-action="open-library"]').focus();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog || busy) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });

  $("#material-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (composing || busy) return;
    const name = $("#material-name").value.normalize("NFC").trim();
    const tags = [...new Map($("#material-tags").value.split(/[,，、\s]+/u).filter(Boolean).map((tag) => [normalize(tag), tag.normalize("NFC").trim()])).values()];
    if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
      $("#name-error").hidden = false;
      $("#name-error").textContent = "请填写 1–80 字的素材名称，不能包含控制字符。";
      $("#material-name").setAttribute("aria-invalid", "true");
      $("#material-name").focus();
      return;
    }
    $("#name-error").hidden = true;
    $("#material-name").removeAttribute("aria-invalid");
    if (tags.length > 12 || tags.some((tag) => [...tag].length > 24)) {
      $("#form-error").hidden = false;
      $("#form-error").textContent = "最多 12 个标签，每个标签不超过 24 字。";
      $("#material-tags").focus();
      return;
    }
    $("#form-error").hidden = true;
    const description = $("#material-description").value.trim();
    setBusy(true);
    $("#save-progress").textContent = formMode === "edit" ? "模拟保存素材信息…" : "模拟复制 2 张图片并保存文字…";
    setTimeout(() => {
      const editing = formMode === "edit";
      if (editing) {
        const item = materials.find((entry) => entry.id === formSource.id);
        Object.assign(item, { name, tags, description, updated: ++sequence });
      } else {
        const item = { ...structuredClone(formSource), id: `demo-${++sequence}`, name, tags, description, favorite: false, updated: sequence };
        materials.push(item);
        selectedId = item.id;
      }
      setBusy(false);
      $("#save-dialog").close();
      scenario = "normal"; $("#scenario").value = scenario;
      if (!editing) { filter = "all"; query = ""; $("#library-search").value = ""; }
      if (!$("#library-dialog").open) openLibrary(true);
      else renderLibrary();
      feedback(editing ? "演示：素材信息已更新，组件内的标题与内容未改变。" : "演示：已保存为新素材。文字和图片复制流程已模拟，未写入真实素材库。");
    }, 650);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.close) { if (!busy) document.getElementById(button.dataset.close).close(); return; }
    if (button.dataset.filter) { filter = button.dataset.filter; renderLibrary(); return; }
    if (button.dataset.select) {
      selectedId = button.dataset.select;
      document.querySelectorAll("[data-select]").forEach((card) => {
        const active = card.dataset.select === selectedId;
        card.setAttribute("aria-pressed", String(active));
        card.querySelector(".selected-mark").innerHTML = active ? icon("check") : "";
      });
      renderDetail();
      return;
    }
    switch (button.dataset.action) {
      case "theme": document.body.classList.toggle("dark"); break;
      case "open-library": openLibrary(); break;
      case "manage": openLibrary(true); break;
      case "workspace": $("#insertion-anchor").focus(); break;
      case "save-source": showSave(); break;
      case "go-save": $("#library-dialog").close(); showSave(); break;
      case "edit-metadata": showSave(true); break;
      case "clear-search": clearTimeout(searchTimer); query = ""; $("#library-search").value = ""; renderLibrary(); $("#library-search").focus(); break;
      case "reset-filters": filter = "all"; query = ""; $("#library-search").value = ""; renderLibrary(); $("#library-search").focus(); break;
      case "retry": scenario = "normal"; $("#scenario").value = scenario; renderLibrary(); feedback("演示状态已恢复；真实产品会重新检查文件或数据库。"); break;
      case "favorite": {
        const item = selected(); item.favorite = !item.favorite;
        renderLibrary();
        $("#detail [data-action='favorite']")?.focus();
        feedback(item.favorite ? "已收藏这份演示素材。" : "已取消收藏。");
        break;
      }
      case "full-preview":
        $("#full-preview").innerHTML = component(selected(), false, scenario === "missing");
        openDialog("preview-dialog");
        break;
      case "delete":
        $("#delete-description").textContent = `“${selected().name}”将保留 30 天，可在回收站恢复。已经插入各项目的文字和图片副本不会被删除。`;
        openDialog("delete-dialog");
        break;
      case "confirm-delete":
        selected().deleted = true;
        $("#delete-dialog").close();
        renderLibrary();
        feedback("演示：已移入回收站。左侧“回收站”可以恢复，项目副本不受影响。");
        break;
      case "restore":
        selected().deleted = false;
        renderLibrary();
        feedback("演示：素材已恢复，可以在“全部素材”找到。");
        break;
      case "insert": {
        if (busy || !selected() || selected().deleted || scenario === "missing") return;
        const item = { ...structuredClone(selected()), instanceId: `instance-${++sequence}` };
        busy = true;
        $("#library-dialog .library-header").inert = true;
        $("#library-dialog .library-body").inert = true;
        $("#library-dialog .review-bar").inert = true;
        $("#insert-button").disabled = true;
        $("#insert-button").textContent = "正在复制…";
        setTimeout(() => {
          inserted.push(item);
          renderInserted();
          busy = false;
          $("#library-dialog .library-header").inert = false;
          $("#library-dialog .library-body").inert = false;
          $("#library-dialog .review-bar").inert = false;
          $("#insert-button").innerHTML = icon("plus") + "插入到文档";
          const instance = document.querySelector(`[data-instance="${item.instanceId}"]`);
          focusOrigins.set($("#library-dialog"), instance);
          $("#library-dialog").close();
          instance.focus(); instance.scrollIntoView({ block: "center", behavior: "instant" });
          toast(`演示：已插入“${item.name}”的独立副本。`, () => { inserted = inserted.filter((entry) => entry.instanceId !== item.instanceId); renderInserted(); $("#insertion-anchor").focus(); });
        }, 650);
        break;
      }
      case "dismiss-toast": $("#toast").hidden = true; break;
    }
  });
  openLibrary();
})();
