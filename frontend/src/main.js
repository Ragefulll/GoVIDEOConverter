import './style.css';
import { AddPaths, AppVersion, CPUCount, CancelFile, CancelProcessing, CheckFFmpeg, CheckUpdates, ClearFiles, DefaultSettings, ExportPresets, HasPreviewProxy, ImportPresets, InstallFFmpeg, ListFiles, MakePreviewProxy, PickFFmpeg, RemoveFile, StartFile, StartProcessing } from '../wailsjs/go/main/App';
import { EventsOn, OnFileDrop } from '../wailsjs/runtime/runtime';

const state = { files: [], selected: null, settings: null, running: false, adding: false, ffmpeg: null, ffmpegChecked: false, activeResolution: '1080', resBitrates: {} };

const resolutionPresets = {
  '360': { bitrateKbps: 800, maxrateKbps: 1000, bufsizeKbps: 2000 },
  '720': { bitrateKbps: 2500, maxrateKbps: 3000, bufsizeKbps: 6000 },
  '1080': { bitrateKbps: 5000, maxrateKbps: 6000, bufsizeKbps: 12000 },
  '2k': { bitrateKbps: 12000, maxrateKbps: 14000, bufsizeKbps: 28000 },
  '4k': { bitrateKbps: 25000, maxrateKbps: 30000, bufsizeKbps: 60000 },
};

function seedResBitrates() {
  Object.entries(resolutionPresets).forEach(([r, b]) => {
    if (!state.resBitrates[r]) state.resBitrates[r] = { ...b };
  });
}

const help = {
  presets: 'Пресет — сохраненный набор настроек. Выберите пресет, чтобы применить сохраненные параметры, или сохраните текущие настройки под новым именем. Импорт/экспорт позволяют перенести пресеты между устройствами в виде JSON-файла.',
  resolution: 'Целевые разрешения. Можно выбрать несколько — для каждого будет создано отдельное видео с префиксом разрешения (например 720_ и 1080_). Битрейт/maxrate/bufsize ниже относятся к выбранному (активному) разрешению и хранятся отдельно для каждого.',
  codec: 'Видеокодек выходного файла. auto подбирает кодек по исходнику. h264 совместим почти везде, hevc/av1 дают лучшее сжатие, vp9 обычно для webm, prores/ffv1 для монтажных или архивных задач. При выборе контейнера webm кодек автоматически ставится vp9. Для vp9 и av1 целевой битрейт автоматически снижается (vp9 ~50%, av1 ~40% от значения h264) — при том же качестве файл получается заметно меньше. Для vp9 в режиме битрейта используется двухпроходное кодирование для точного соответствия размеру.',
  encoder: 'FFmpeg-энкодер. auto выбирает программный энкодер по кодеку: libx264, libx265, libsvtav1, libvpx-vp9, prores_ks, ffv1. Можно указать вручную: h264_nvenc, hevc_nvenc, av1_nvenc, h264_qsv, hevc_qsv, av1_qsv, h264_amf, hevc_amf, libx264, libx265, libsvtav1, libaom-av1, libvpx-vp9, prores_ks, ffv1.',
  container: 'Формат контейнера. auto подбирает контейнер по кодеку: mp4 для h264/hevc/av1, webm для vp9, mov для prores, mkv для ffv1.',
  compressionMode: 'Режим управления сжатием. bitrate держит заданный поток, CRF держит визуальное качество: меньше CRF - выше качество и больше размер.',
  crf: 'Constant Rate Factor. Обычно 18-23 для H.264, 20-28 для H.265/AV1. Значение 0 почти без потерь, 51 очень сильное сжатие.',
  bitrateKbps: 'Средний видеобитрейт в килобитах в секунду для активного разрешения. Каждое разрешение хранит свой битрейт.',
  maxrateKbps: 'Пиковый битрейт для VBV-ограничения для активного разрешения. Помогает избежать слишком больших скачков размера потока.',
  bufsizeKbps: 'Размер VBV-буфера для активного разрешения. Обычно ставится примерно в 2x от maxrate, влияет на плавность контроля битрейта.',
  bitDepth: 'Глубина цвета выходного видео: 8-bit для максимальной совместимости, 10-bit для HDR/градиентов и современных кодеков.',
  throttle: 'Сколько файлов обрабатывать параллельно. Больше потоков быстрее загружает CPU/GPU, но может упереться в память или энкодер.',
  outputPrefix: 'Префикс имени выходного файла. Например "_" создаст _video.mp4 рядом с исходником. При нескольких разрешениях перед префиксом добавляется разрешение: 720_, 1080_.',
  outputDirectory: 'Папка для результатов. Если пусто, файл сохраняется рядом с исходным видео.',
  removeAudio: 'Удаляет аудиодорожку из результата.',
  firstScreen: 'Создает JPG первого кадра рядом с обработанным видео.',
  lastScreen: 'Создает JPG последнего кадра рядом с обработанным видео.',
  allKeyframes: 'Делает каждый кадр ключевым (I-кадром). Ускоряет перемотку и разрезание, но увеличивает размер файла.',
  overwrite: 'Разрешает заменить существующий выходной файл.',
  validateDecode: 'После кодирования прогоняет проверку декодирования результата через FFmpeg.',
};

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="title-row">
          <h1>GoVIDEOConverter</h1>
          <span id="versionBadge" class="version-badge">v…</span>
        </div>
        <p>Пакетная обработка видео через FFmpeg с контролем качества, разрешения и прогресса.</p>
      </div>
      <div class="actions">
        <button id="ffmpegBadge" class="ffmpeg-badge" title="Проверить FFmpeg">FFmpeg: проверка...</button>
        <button id="startBtn" class="primary">Обработать</button>
        <button id="cancelBtn">Стоп</button>
        <button id="clearBtn">Очистить</button>
      </div>
    </header>

    <section class="settings">
      <label class="wide">
        <span class="label-title">Разрешение${info('resolution')}</span>
        <span class="res-group">${['360','720','1080','2k','4k'].map(r => `<label class="res-check"><input id="res-${r}" type="checkbox" value="${r}" /><span>${r}</span></label>`).join('')}</span>
      </label>
      ${field('codec', 'Кодек', `<select id="codec">${options(['auto','h264','hevc','av1','vp9','prores','ffv1'], 'h264')}</select>`)}
      ${field('encoder', 'Энкодер', `<select id="encoder">${options(['auto','h264_nvenc','hevc_nvenc','av1_nvenc','h264_qsv','hevc_qsv','av1_qsv','h264_amf','hevc_amf','h264_mf','hevc_mf','libx264','libx265','libsvtav1','libaom-av1','libvpx-vp9','prores_ks','ffv1'], 'auto')}</select>`)}
      ${field('container', 'Контейнер', `<select id="container">${options(['auto','mp4','mov','mkv','webm'], 'mp4')}</select>`)}
      ${field('compressionMode', 'Сжатие', `<select id="compressionMode">${options(['bitrate','crf'], 'bitrate')}</select>`)}
      ${field('crf', 'CRF', `<input id="crf" type="number" min="0" max="51" value="23" />`)}
      ${field('bitrateKbps', `Битрейт <span class="res-tag" id="bitrateResLabel">(1080)</span>, kbps`, `<input id="bitrateKbps" type="number" value="5000" />`)}
      ${field('maxrateKbps', `Maxrate <span class="res-tag" id="maxrateResLabel">(1080)</span>, kbps`, `<input id="maxrateKbps" type="number" value="6000" />`)}
      ${field('bufsizeKbps', `Bufsize <span class="res-tag" id="bufsizeResLabel">(1080)</span>, kbps`, `<input id="bufsizeKbps" type="number" value="12000" />`)}
      ${field('bitDepth', 'Bit depth', `<select id="bitDepth">${options(['8','10'], '8')}</select>`)}
      ${field('throttle', 'Потоки', `<input id="throttle" type="number" min="1" value="4" />`)}
      ${field('outputPrefix', 'Префикс', `<input id="outputPrefix" value="_" />`)}
      ${field('outputDirectory', 'Папка вывода', `<input id="outputDirectory" placeholder="пусто = рядом с исходником" />`, 'wide')}
      ${checkField('removeAudio', 'убрать аудио')}
      ${checkField('firstScreen', 'firstScreen JPG')}
      ${checkField('lastScreen', 'lastScreen JPG')}
      ${checkField('allKeyframes', 'каждый кадр ключевой')}
      ${checkField('overwrite', 'перезаписывать')}
      ${checkField('validateDecode', 'validate decode')}
      <div class="preset-wrap wide">
        <span class="label-title">Пресет${info('presets')}</span>
        <span class="preset-row">
          <select id="presetSelect"></select>
          <button id="presetImport" type="button" title="Загрузить пресеты из JSON-файла">Импорт</button>
          <button id="presetExport" type="button" title="Сохранить все пресеты в JSON-файл">Экспорт</button>
          <button id="presetSave" type="button" class="primary">Сохранить</button>
          <button id="presetDelete" type="button">Удалить</button>
        </span>
      </div>
    </section>

    <section id="dropzone" class="dropzone">
      <strong>Перетащите видео или папку сюда</strong>
      <span>MP4, MKV, MOV, AVI, WEBM, MTS, TS и другие форматы будут прочитаны через ffprobe.</span>
    </section>

    <section class="workspace">
      <div class="queue">
        <div class="panel-head queue-head"><h2>Очередь</h2><span id="count">0 файлов</span><div id="queueFill" class="panel-fill"></div></div>
        <div id="fileList" class="file-list"></div>
      </div>
      <aside class="details">
        <div class="panel-head"><h2>Предпросмотр</h2><span id="statusBadge">нет выбора</span></div>
        <div id="previewWrap" class="preview-wrap empty">
          <video id="previewVideo" preload="metadata" playsinline></video>
          <div class="seek-wrap">
            <div class="seek-track"></div>
            <div id="seekFill" class="seek-fill"></div>
            <div id="seekThumb" class="seek-thumb"></div>
            <input id="seekBar" type="range" min="0" max="0" value="0" step="any" disabled title="Перемотка">
            <div id="seekInfo" class="seek-info"></div>
            <div id="seekTip" class="seek-tip hidden"><div id="seekTipText" class="seek-tip-text"></div></div>
          </div>
          <div class="transport">
            <button id="transportPrev" class="icon-btn" title="Предыдущий кадр"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7zM18 5l-9 7 9 7z"/></svg></button>
            <button id="transportMinus" class="transport-text" title="Назад на 1 секунду">−1 с</button>
            <button id="transportPlay" class="icon-btn primary" title="Play / Pause"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
            <button id="transportPlus" class="transport-text" title="Вперёд на 1 секунду">+1 с</button>
            <button id="transportNext" class="icon-btn" title="Следующий кадр"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2zM6 5l9 7-9 7z"/></svg></button>
          </div>
          <div id="previewTime" class="preview-time">0:00 / 0:00</div>
          <div id="previewHint" class="preview-hint hidden">
            <span>Формат не поддерживается для прямого просмотра. Можно создать превью через FFmpeg.</span>
            <button id="makePreviewBtn" class="primary">Создать превью</button>
          </div>
          <div id="previewMaking" class="preview-making hidden">
            <div id="previewMakingBar" class="card-fill"></div>
            <div class="modal-row"><span>Создание превью через FFmpeg...</span><strong id="previewMakingPct">0%</strong></div>
          </div>
        </div>
        <div class="panel-head meta-head"><h2>Метаданные</h2></div>
        <div id="meta" class="meta empty">Выберите видео в очереди.</div>
      </aside>
    </section>
    <div id="addModal" class="modal hidden">
      <div class="modal-card">
        <div id="addProgress" class="card-fill"></div>
        <h2>Добавление в очередь</h2>
        <p id="addPhase">Сканирование</p>
        <div class="modal-row"><span id="addFile">Подготовка...</span><strong id="addCount">0%</strong></div>
      </div>
    </div>

    <div id="ffmpegModal" class="modal hidden">
      <div class="modal-card ffmpeg-card">
        <div id="ffmpegProgress" class="card-fill"></div>
        <h2 id="ffmpegTitle">Проверка FFmpeg</h2>
        <p id="ffmpegMsg">Поиск установленного FFmpeg...</p>
        <div id="ffmpegInstallRow" class="ffmpeg-actions hidden">
          <button id="ffmpegInstallBtn" class="primary">Скачать и установить</button>
          <button id="ffmpegPickBtn">Выбрать папку вручную</button>
        </div>
        <div id="ffmpegProgressWrap" class="ffmpeg-progress hidden">
          <div class="modal-row"><span id="ffmpegDetail">Подготовка...</span></div>
        </div>
      </div>
    </div>

    <div id="presetModal" class="modal hidden">
      <div class="modal-card">
        <h2>Сохранить пресет</h2>
        <p>Пресет сохранит текущие настройки (кодек, битрейт, разрешения и т.д.) для быстрого применения.</p>
        <input id="presetNameInput" type="text" placeholder="Например: YouTube 1080" />
        <div class="preset-modal-actions">
          <button id="presetSaveOk" class="primary">Сохранить</button>
          <button id="presetSaveCancel">Отмена</button>
        </div>
      </div>
    </div>

    <div id="updateModal" class="update-pop hidden">
      <div class="update-card" id="updateCard">
        <div id="updateBg" class="update-bg"></div>
        <div id="updateIcon" class="update-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40 20" /></svg>
        </div>
        <div class="update-head">
          <h2 id="updateTitle">Проверка обновлений</h2>
          <p id="updateMsg">Подключение к серверу...</p>
        </div>
        <div class="modal-row"><span id="updateDetail"></span><strong id="updatePct"></strong></div>
      </div>
    </div>

    <div id="toast" class="toast hidden"></div>
  </main>
`;

function options(values, selected) {
  return values.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`).join('');
}

function field(id, title, control, extraClass = '') {
  return `<label class="${extraClass}">
    <span class="label-title">${title}${info(id)}</span>
    ${control}
  </label>`;
}

function checkField(id, title) {
  const checked = id === 'removeAudio' || id === 'validateDecode' ? 'checked' : '';
  return `<label class="check"><input id="${id}" type="checkbox" ${checked} /><span>${title}</span>${info(id)}</label>`;
}

function info(id) {
  return `<span class="info" tabindex="0">i<span class="tooltip">${escapeHtml(help[id] || '')}</span></span>`;
}

function collectSettings() {
  const ids = ['codec','encoder','container','compressionMode','outputPrefix','outputDirectory'];
  const s = {};
  ids.forEach(id => s[id] = document.getElementById(id).value);
  ['crf','bitrateKbps','maxrateKbps','bufsizeKbps','bitDepth','throttle'].forEach(id => s[id] = Number(document.getElementById(id).value));
  ['removeAudio','firstScreen','lastScreen','allKeyframes','overwrite','validateDecode'].forEach(id => s[id] = document.getElementById(id).checked);
  const resolutions = selectedResolutions();
  s.resolutions = resolutions.length ? resolutions : ['1080'];
  s.resolution = s.resolutions[0];
  saveActiveResolutionBitrate();
  const bitrateByResolution = {};
  resolutions.forEach(r => {
    bitrateByResolution[r] = { ...(state.resBitrates[r] || resolutionPresets[r] || { bitrateKbps: 5000, maxrateKbps: 6000, bufsizeKbps: 12000 }) };
  });
  s.bitrateByResolution = bitrateByResolution;
  s.preserveAspectLetter = true;
  return s;
}

function selectedResolutions() {
  return ['360','720','1080','2k','4k'].filter(r => document.getElementById('res-' + r).checked);
}

function saveActiveResolutionBitrate() {
  const r = state.activeResolution;
  if (!state.resBitrates[r]) state.resBitrates[r] = { ...(resolutionPresets[r] || { bitrateKbps: 5000, maxrateKbps: 6000, bufsizeKbps: 12000 }) };
  ['bitrateKbps','maxrateKbps','bufsizeKbps'].forEach(id => {
    const el = document.getElementById(id);
    if (el) state.resBitrates[r][id] = Number(el.value) || 0;
  });
}

function loadActiveResolutionBitrate() {
  const b = state.resBitrates[state.activeResolution];
  if (b) {
    ['bitrateKbps','maxrateKbps','bufsizeKbps'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = b[id];
    });
  }
  ['bitrateResLabel','maxrateResLabel','bufsizeResLabel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = `(${state.activeResolution})`;
  });
}

function applySettings(s) {
  Object.entries(s).forEach(([key, value]) => {
    if (key === 'resolutions') {
      ['360','720','1080','2k','4k'].forEach(r => {
        const el = document.getElementById('res-' + r);
        if (el) el.checked = Array.isArray(value) ? value.includes(r) : value === r;
      });
      return;
    }
    if (key === 'resolution') {
      const el = document.getElementById('res-' + value);
      if (el && !Array.isArray(s.resolutions)) el.checked = true;
      return;
    }
    if (key === 'bitrateByResolution') {
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([r, b]) => {
          if (b && typeof b === 'object') state.resBitrates[r] = { ...(state.resBitrates[r] || {}), ...b };
        });
      }
      loadActiveResolutionBitrate();
      return;
    }
    if (key === 'bitrateKbps' || key === 'maxrateKbps' || key === 'bufsizeKbps') {
      const el = document.getElementById(key);
      if (el) el.value = value;
      if (state.resBitrates[state.activeResolution]) state.resBitrates[state.activeResolution][key] = Number(value);
      return;
    }
    const el = document.getElementById(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  });
}

function onResolutionChange(event) {
  saveActiveResolutionBitrate();
  const r = event.target.value;
  const checked = selectedResolutions();
  if (event.target.checked) {
    state.activeResolution = r;
  } else {
    state.activeResolution = checked[0] || '1080';
  }
  loadActiveResolutionBitrate();
}

async function addPaths(paths) {
  showAddModal();
  try {
    const added = await AddPaths(paths);
    state.files = mergeFiles(state.files, added);
    if (!state.selected && state.files[0]) state.selected = state.files[0].id;
    render();
  } catch (error) {
    hideAddModal();
    console.error(error);
  }
}

function mergeFiles(existing, added) {
  const map = new Map(existing.map(f => [f.path.toLowerCase(), f]));
  added.forEach(f => map.set(f.path.toLowerCase(), {...map.get(f.path.toLowerCase()), ...f}));
  return [...map.values()];
}

function render() {
  renderQueueSummary();
  const list = document.getElementById('fileList');
  list.innerHTML = state.files.map(file => `
    <article class="file ${statusClass(file)} ${file.id === state.selected ? 'selected' : ''}" data-id="${file.id}" style="--progress:${Math.max(0, Math.min(100, file.progress || 0))}%">
      <div class="file-fill"></div>
      <div class="file-row"><strong>${escapeHtml(file.name)}</strong><span>${file.progress.toFixed(0)}%</span></div>
      <div class="file-row muted"><span>${file.status}</span><span>${formatBytes(file.size)}</span></div>
      <div class="file-actions">
        <button class="icon-btn" data-action="start" data-id="${file.id}" title="Запустить только это видео" aria-label="Запустить">${icon('play')}</button>
        <button class="icon-btn" data-action="stop" data-id="${file.id}" title="Остановить это видео" aria-label="Остановить">${icon('stop')}</button>
        <button class="icon-btn danger" data-action="remove" data-id="${file.id}" title="Удалить из очереди" aria-label="Удалить">${icon('trash')}</button>
      </div>
      ${file.error ? `<div class="error">${escapeHtml(file.error)}</div>` : ''}
    </article>
  `).join('') || `<div class="empty">Очередь пуста.</div>`;
  list.querySelectorAll('.file').forEach(card => card.addEventListener('click', () => { state.selected = card.dataset.id; render(); }));
  list.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', handleFileAction));
  renderMeta();
}

function renderQueueSummary() {
  const summary = queueSummary();
  document.getElementById('count').textContent = `${summary.total} видео | готово ${summary.done} | в процессе ${summary.processing}`;
  const fill = document.getElementById('queueFill');
  if (fill) {
    const pct = summary.total > 0 ? Math.round(summary.progress / summary.total) : 0;
    fill.style.setProperty('--progress', `${Math.max(0, Math.min(100, pct))}%`);
    fill.classList.toggle('done', summary.total > 0 && pct >= 100);
  }
}

function queueSummary() {
  const doneStatuses = new Set(['Готово', 'Пропущено']);
  const processingStatuses = new Set(['Обработка', 'В очереди']);
  return state.files.reduce((acc, file) => {
    acc.total += 1;
    if (doneStatuses.has(file.status)) {
      acc.done += 1;
      acc.progress += 100;
    } else if (processingStatuses.has(file.status)) {
      acc.processing += 1;
      acc.progress += Math.max(0, Math.min(100, file.progress || 0));
    } else {
      acc.progress += Math.max(0, Math.min(100, file.progress || 0));
    }
    return acc;
  }, { total: 0, done: 0, processing: 0, progress: 0 });
}

function statusClass(file) {
  if (file.status === 'Готово' || file.status === 'Пропущено') return 'done';
  if (file.status === 'Обработка' || file.status === 'В очереди') return 'processing';
  return 'pending';
}

function icon(name) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h10l-1 12H8L7 9zm3 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>',
  };
  return icons[name] || '';
}

async function handleFileAction(event) {
  event.stopPropagation();
  const id = event.currentTarget.dataset.id;
  const action = event.currentTarget.dataset.action;
  if (action === 'start') {
    await StartFile(id, collectSettings());
  }
  if (action === 'stop') {
    await CancelFile(id);
  }
  if (action === 'remove') {
    await RemoveFile(id);
    state.files = state.files.filter(file => file.id !== id);
    if (state.selected === id) state.selected = state.files[0]?.id || null;
    render();
  }
}

function renderMeta() {
  const file = state.files.find(f => f.id === state.selected);
  document.getElementById('statusBadge').textContent = file ? file.status : 'нет выбора';
  if (state.selected !== previewId) {
    previewId = state.selected;
    loadPreview(file);
  }
  const meta = document.getElementById('meta');
  if (!file) {
    meta.className = 'meta empty';
    meta.textContent = 'Выберите видео в очереди.';
    return;
  }
  meta.className = 'meta';
  const m = file.meta;
  const colorInfo = [m.colorSpace, m.colorTransfer, m.colorPrimaries, m.colorRange].filter(Boolean).join(', ');
  meta.innerHTML = `
    <h3>${escapeHtml(file.name)}</h3>
    <dl>
      <dt>Путь</dt><dd>${escapeHtml(file.path)}</dd>
    </dl>
    <h4 class="meta-head">Формат</h4>
    <dl>
      <dt>Контейнер</dt><dd>${escapeHtml(m.format || '-')}${m.formatLongName ? ' — ' + escapeHtml(m.formatLongName) : ''}</dd>
      <dt>Размер файла</dt><dd>${fmtSize(m.fileSize || file.size)}</dd>
      <dt>Длительность</dt><dd>${formatDuration(m.duration)}</dd>
      <dt>Битрейт</dt><dd>${fmtKbps(m.bitrate)}</dd>
      <dt>Кодировщик</dt><dd>${escapeHtml(m.encoder || '-')}</dd>
      <dt>Создан</dt><dd>${escapeHtml(m.creationTime || '-')}</dd>
      <dt>Потоков</dt><dd>${m.streamCount ? fmtInt(m.streamCount) : '-'}</dd>
    </dl>
    <h4 class="meta-head">Видео</h4>
    <dl>
      <dt>Кодек</dt><dd>${escapeHtml(m.codec || '-')}</dd>
      <dt>Профиль</dt><dd>${escapeHtml(m.videoProfile || '-')}</dd>
      <dt>Уровень</dt><dd>${escapeHtml(m.videoLevel || '-')}</dd>
      <dt>Разрешение</dt><dd>${m.width}x${m.height}</dd>
      <dt>Соотношение</dt><dd>${escapeHtml(m.aspectRatio || '-')}</dd>
      <dt>Пиксельный формат</dt><dd>${escapeHtml(m.pixelFormat || '-')}</dd>
      <dt>Битовая глубина</dt><dd>${m.bitDepth ? m.bitDepth + ' бит' : '-'}</dd>
      <dt>FPS</dt><dd>${escapeHtml(m.fps || '-')}${m.avgFps && m.avgFps !== m.fps ? ' (ср. ' + escapeHtml(m.avgFps) + ')' : ''}</dd>
      <dt>Битрейт</dt><dd>${fmtKbps(m.bitrateVideo)}</dd>
      <dt>Maxrate</dt><dd>${fmtKbps(m.maxBitrate)}</dd>
      <dt>Кадров</dt><dd>${fmtInt(m.nbFrames)}</dd>
      <dt>B-кадры</dt><dd>${m.hasBFrames ? 'есть' : 'нет'}</dd>
      <dt>Цвет</dt><dd>${escapeHtml(colorInfo) || '-'}</dd>
      <dt>Чересстрочность</dt><dd>${escapeHtml(m.fieldOrder || '-')}</dd>
      <dt>Rotation</dt><dd>${m.rotation ? m.rotation + '°' : '-'}</dd>
    </dl>
    <h4 class="meta-head">Аудио</h4>
    <dl>
      <dt>Кодек</dt><dd>${escapeHtml(m.audioCodec || 'нет')}</dd>
      <dt>Битрейт</dt><dd>${fmtKbps(m.audioBitrate)}</dd>
      <dt>Частота</dt><dd>${m.audioSampleRate ? fmtInt(m.audioSampleRate) + ' Гц' : '-'}</dd>
      <dt>Каналы</dt><dd>${m.audioChannels ? m.audioChannels + (m.audioChannelLayout ? ' (' + escapeHtml(m.audioChannelLayout) + ')' : '') : '-'}</dd>
      <dt>Глубина</dt><dd>${m.audioBitDepth ? m.audioBitDepth + ' бит' : '-'}</dd>
      <dt>Длительность</dt><dd>${m.audioDuration ? formatDuration(m.audioDuration) : '-'}</dd>
      <dt>Кадров</dt><dd>${fmtInt(m.audioNbFrames)}</dd>
    </dl>
    <h4 class="meta-head">Другие потоки</h4>
    <dl>
      <dt>Субтитры</dt><dd>${escapeHtml(m.subtitleCodec || 'нет')}</dd>
      <dt>Данные</dt><dd>${escapeHtml(m.dataCodec || 'нет')}</dd>
    </dl>
    <dl>
      <dt>Выход</dt><dd>${escapeHtml(file.output || 'будет рассчитан при обработке')}</dd>
    </dl>
  `;
}

function updateFileProgress(ev) {
  const file = state.files.find(f => f.id === ev.id);
  if (!file) return;
  const statusChanged = file.status !== ev.status;
  file.status = ev.status;
  file.progress = Math.max(0, Math.min(100, ev.progress || file.progress || 0));
  file.output = ev.output || file.output;
  file.error = ev.error || '';
  const card = document.querySelector(`.file[data-id="${CSS.escape(ev.id)}"]`);
  if (card) {
    card.className = `file ${statusClass(file)}${file.id === state.selected ? ' selected' : ''}`;
    card.style.setProperty('--progress', `${file.progress}%`);
    const rows = card.querySelectorAll('.file-row');
    if (rows[0]) rows[0].lastElementChild.textContent = `${file.progress.toFixed(0)}%`;
    if (rows[1]) rows[1].firstElementChild.textContent = file.status;
    if (file.error) {
      let err = card.querySelector('.error');
      if (!err) {
        err = document.createElement('div');
        err.className = 'error';
        card.appendChild(err);
      }
      err.textContent = file.error;
    } else {
      const err = card.querySelector('.error');
      if (err) err.remove();
    }
  }
  renderQueueSummary();
  if (statusChanged && file.id === state.selected) renderMeta();
}

let previewId = null;
let previewFps = 30;
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

const previewVideo = document.getElementById('previewVideo');
const transportPlay = document.getElementById('transportPlay');
const seekBar = document.getElementById('seekBar');
const seekFill = document.getElementById('seekFill');
const seekThumb = document.getElementById('seekThumb');
const seekTip = document.getElementById('seekTip');
const seekTipText = document.getElementById('seekTipText');

function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const frac = String(Math.round((t - Math.floor(t)) * 100000)).padStart(5, '0');
  const base = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return `${base}.${frac}`;
}

function setPreviewTime(forceCur) {
  const el = document.getElementById('previewTime');
  const info = document.getElementById('seekInfo');
  const rawCur = isFinite(forceCur) ? forceCur : previewVideo.currentTime;
  const cur = isFinite(rawCur) && rawCur > 0 ? rawCur : 0;
  const dur = previewVideo.duration;
  const noVideo = !isFinite(dur) || dur <= 0;
  seekBar.max = noVideo ? 0 : dur;
  seekBar.value = noVideo ? 0 : cur;
  seekBar.disabled = noVideo;
  updateSeekUI(noVideo ? 0 : cur / dur);
  const fps = previewFps || 30;
  const totalFrames = noVideo ? 0 : Math.floor(dur * fps);
  const curFrame = noVideo ? 0 : Math.min(Math.floor(cur * fps) + 1, totalFrames);
  info.textContent = noVideo ? '' : `${fmtTime(cur)} | кадр ${curFrame}/${totalFrames}`;
  el.textContent = noVideo
    ? '0:00 / 0:00'
    : `${fmtTime(cur)} (${cur.toFixed(5)}с) / ${fmtTime(dur)} (${dur.toFixed(5)}с)`;
}

let makingProxy = false;
let previewSrcKind = 'none'; // 'none' | 'native' | 'proxy'
const DEFAULT_HINT = 'Формат не поддерживается для прямого просмотра. Можно создать превью через FFmpeg.';
const NATIVE_PREVIEW_MAX_BYTES = 500 * 1024 * 1024;

function setPreviewSrc(path, kind) {
  previewSrcKind = kind;
  document.getElementById('previewWrap').classList.remove('no-video');
  hidePreviewHint();
  hidePreviewMaking();
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewVideo.load();
  previewVideo.src = `/preview/?path=${encodeURIComponent(path)}`;
  previewVideo.load();
  transportPlay.innerHTML = PLAY_ICON;
  setPreviewTime();
}

function loadPreview(file) {
  const wrap = document.getElementById('previewWrap');
  makingProxy = false;
  resetPreviewHint();
  hidePreviewHint();
  hidePreviewMaking();
  if (!file || !file.path) {
    previewSrcKind = 'none';
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    transportPlay.innerHTML = PLAY_ICON;
    wrap.classList.add('empty');
    wrap.classList.remove('no-video');
    setPreviewTime();
    return;
  }
  previewFps = parseFloat(file.meta && file.meta.fps) || 30;
  wrap.classList.remove('empty');
  if (!isNativelyPlayable(file) || (file.size && file.size > NATIVE_PREVIEW_MAX_BYTES)) {
    wrap.classList.add('no-video');
    checkPreviewCache(file);
    return;
  }
  setPreviewSrc(file.path, 'native');
}

function isNativelyPlayable(file) {
  if (!file || !file.meta) return true;
  const codec = String(file.meta.codec || '').toLowerCase();
  const fmt = String(file.meta.format || '').toLowerCase();
  const containers = ['mp4', 'quicktime', 'webm', 'ogg', 'mov'];
  if (!containers.some(c => fmt.includes(c))) return false;
  const badCodecs = ['prores', 'ffv1', 'mpeg2video', 'mpeg4', 'msmpeg4', 'wmv2', 'wmv3', 'vc1'];
  return badCodecs.every(bad => !codec.includes(bad));
}

async function checkPreviewCache(file) {
  try {
    const proxy = await HasPreviewProxy(file.path);
    if (proxy) setPreviewSrc(proxy, 'proxy');
    else showPreviewHint();
  } catch (error) {
    showPreviewHint();
  }
}

function resetPreviewHint() {
  const hint = document.getElementById('previewHint');
  hint.querySelector('span').textContent = DEFAULT_HINT;
  hint.querySelector('button').classList.remove('hidden');
}

function showPreviewHint() {
  hidePreviewMaking();
  document.getElementById('previewHint').classList.remove('hidden');
}

function hidePreviewHint() {
  document.getElementById('previewHint').classList.add('hidden');
}

function showPreviewMaking() {
  makingProxy = true;
  hidePreviewHint();
  document.getElementById('previewWrap').classList.add('no-video');
  document.getElementById('previewMaking').classList.remove('hidden');
  setPreviewMakingPct(0);
}

function hidePreviewMaking() {
  makingProxy = false;
  document.getElementById('previewMaking').classList.add('hidden');
}

function setPreviewMakingPct(p) {
  p = Math.max(0, Math.min(100, p || 0));
  document.getElementById('previewMakingBar').style.width = `${p}%`;
  document.getElementById('previewMakingPct').textContent = `${Math.round(p)}%`;
}

function onPreviewProxyProgress(ev) {
  setPreviewMakingPct(ev && ev.progress);
}

async function makePreview() {
  const file = state.files.find(f => f.id === state.selected);
  if (!file || makingProxy) return;
  const id = file.id;
  showPreviewMaking();
  try {
    const proxy = await MakePreviewProxy(file.path);
    if (state.selected === id && proxy) setPreviewSrc(proxy, 'proxy');
  } catch (error) {
    if (state.selected === id) {
      hidePreviewMaking();
      resetPreviewHint();
      document.getElementById('previewHint').querySelector('span').textContent = `Не удалось создать превью: ${error}`;
      showPreviewHint();
    }
  }
}

function stepFrame(dir) {
  if (!previewVideo.src || !previewVideo.duration) return;
  previewVideo.pause();
  previewVideo.currentTime = Math.min(Math.max(0, previewVideo.currentTime + dir * (1 / previewFps)), previewVideo.duration);
}

function stepSeconds(dir) {
  if (!previewVideo.src || !previewVideo.duration) return;
  previewVideo.currentTime = Math.min(Math.max(0, previewVideo.currentTime + dir), previewVideo.duration);
}

function togglePlay() {
  if (previewVideo.paused) previewVideo.play().catch(() => {});
  else previewVideo.pause();
}

previewVideo.addEventListener('play', () => { transportPlay.innerHTML = PAUSE_ICON; });
previewVideo.addEventListener('pause', () => { transportPlay.innerHTML = PLAY_ICON; });
previewVideo.addEventListener('loadedmetadata', setPreviewTime);
previewVideo.addEventListener('durationchange', setPreviewTime);
previewVideo.addEventListener('timeupdate', () => { if (!scrubbing) setPreviewTime(); });
previewVideo.addEventListener('seeked', setPreviewTime);

let scrubbing = false;
let seekFrac = 0;

function updateSeekUI(frac) {
  seekFrac = frac;
  const w = seekBar.clientWidth;
  const trackW = Math.max(0, w - 8);
  const center = 4 + frac * trackW;
  const pos = Math.max(0, center - 3);
  seekFill.style.width = `${frac * trackW}px`;
  seekThumb.style.left = `${pos}px`;
}
window.addEventListener('resize', () => {
  if (!seekBar.disabled) updateSeekUI(seekFrac);
});

seekBar.addEventListener('pointerdown', () => { scrubbing = true; });
seekBar.addEventListener('input', () => {
  const val = parseFloat(seekBar.value);
  if (isFinite(val) && previewVideo.duration) {
    previewVideo.currentTime = val;
    setPreviewTime(val);
  }
});
seekBar.addEventListener('pointerup', () => { scrubbing = false; });
seekBar.addEventListener('keyup', () => { scrubbing = false; });
seekBar.addEventListener('change', () => { scrubbing = false; });
window.addEventListener('pointerup', () => { scrubbing = false; });

function updateSeekTip(clientX) {
  const dur = previewVideo.duration;
  if (seekBar.disabled || !isFinite(dur) || dur <= 0) return;
  const rect = seekBar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const t = frac * dur;
  const fps = previewFps || 30;
  seekTipText.textContent = `${fmtTime(t)} | кадр ${Math.floor(t * fps) + 1}`;
  const x = Math.max(6, Math.min(rect.width - 6, clientX - rect.left));
  seekTip.style.left = `${x}px`;
  seekTip.classList.remove('hidden');
}

seekBar.addEventListener('pointermove', e => updateSeekTip(e.clientX));
seekBar.addEventListener('pointerleave', () => seekTip.classList.add('hidden'));
previewVideo.addEventListener('error', async () => {
  if (makingProxy) return;
  const wrap = document.getElementById('previewWrap');
  if (previewSrcKind === 'proxy') {
    resetPreviewHint();
    document.getElementById('previewHint').querySelector('span').textContent = 'Не удалось воспроизвести созданное превью.';
    wrap.classList.add('no-video');
    showPreviewHint();
    return;
  }
  const file = state.files.find(f => f.id === state.selected);
  if (file && !isNativelyPlayable(file)) {
    try {
      const proxy = await HasPreviewProxy(file.path);
      if (proxy) {
        setPreviewSrc(proxy, 'proxy');
        return;
      }
    } catch (e) { /* ignore */ }
  }
  previewSrcKind = 'none';
  wrap.classList.add('no-video');
  showPreviewHint();
});
document.getElementById('transportPrev').addEventListener('click', () => stepFrame(-1));
document.getElementById('transportNext').addEventListener('click', () => stepFrame(1));
document.getElementById('transportMinus').addEventListener('click', () => stepSeconds(-1));
document.getElementById('transportPlus').addEventListener('click', () => stepSeconds(1));
transportPlay.addEventListener('click', togglePlay);
document.getElementById('makePreviewBtn').addEventListener('click', makePreview);

function showAddModal() {
  state.adding = true;
  document.getElementById('addModal').classList.remove('hidden');
  updateAddProgress({ phase: 'Сканирование', progress: 0, current: 0, total: 0, fileName: 'Подготовка...' });
}

function hideAddModal() {
  state.adding = false;
  window.setTimeout(() => document.getElementById('addModal').classList.add('hidden'), 350);
}

function updateAddProgress(event) {
  document.getElementById('addPhase').textContent = event.phase || 'Добавление';
  document.getElementById('addProgress').style.width = `${Math.max(0, Math.min(100, event.progress || 0))}%`;
  document.getElementById('addFile').textContent = event.fileName || (event.total ? 'Анализ файлов...' : 'Сканирование папки...');
  document.getElementById('addCount').textContent = event.total ? `${event.current}/${event.total}` : `${Math.round(event.progress || 0)}%`;
  if (event.done) hideAddModal();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(sec) {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function fmtInt(value) {
  return value ? Number(value).toLocaleString('ru-RU') : '-';
}

function fmtKbps(value) {
  if (!value || value <= 0) return '-';
  if (value >= 1000000) return `${(value / 1000000).toFixed(2).replace('.', ',')} Мбит/с`;
  if (value >= 1000) return `${Math.round(value / 1000)} кбит/с`;
  return `${Math.round(value)} бит/с`;
}

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '-';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2).replace('.', ',')} ГБ`;
  return `${(bytes / 1e6).toFixed(1).replace('.', ',')} МБ`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function checkFfmpeg() {
  const status = await CheckFFmpeg();
  state.ffmpeg = status;
  state.ffmpegChecked = true;
  renderFfmpeg();
}

function renderFfmpeg() {
  const st = state.ffmpeg;
  const modal = document.getElementById('ffmpegModal');
  const badge = document.getElementById('ffmpegBadge');
  if (st && st.installed) {
    modal.classList.add('hidden');
    badge.textContent = 'FFmpeg OK';
    badge.title = `${st.ffmpeg}\n${st.version || ''}`;
    badge.classList.add('ok');
    badge.classList.remove('missing');
    return;
  }
  badge.textContent = 'FFmpeg: нет';
  badge.title = st && st.message ? st.message : 'FFmpeg не найден';
  badge.classList.add('missing');
  badge.classList.remove('ok');
  modal.classList.remove('hidden');
  if (state.ffmpegChecked) setFfmpegState('missing');
  else setFfmpegState('checking');
}

function setFfmpegState(mode, progress = 0, detail = '') {
  const title = document.getElementById('ffmpegTitle');
  const msg = document.getElementById('ffmpegMsg');
  const row = document.getElementById('ffmpegInstallRow');
  const wrap = document.getElementById('ffmpegProgressWrap');
  const bar = document.getElementById('ffmpegProgress');
  const detailEl = document.getElementById('ffmpegDetail');
  if (mode === 'checking') {
    title.textContent = 'Проверка FFmpeg';
    msg.textContent = 'Поиск установленного FFmpeg...';
    row.classList.add('hidden');
    wrap.classList.remove('hidden');
    bar.style.width = '100%';
    detailEl.textContent = 'Поиск...';
  } else if (mode === 'missing') {
    title.textContent = 'FFmpeg не установлен';
    msg.textContent = 'Для обработки видео требуется FFmpeg. Скачайте и установите его автоматически или укажите папку с ffmpeg/ffprobe вручную.';
    row.classList.remove('hidden');
    wrap.classList.add('hidden');
    bar.style.width = '0%';
  } else if (mode === 'installing') {
    title.textContent = 'Установка FFmpeg';
    msg.textContent = 'Загрузка и распаковка FFmpeg. Это может занять несколько минут.';
    row.classList.add('hidden');
    wrap.classList.remove('hidden');
    bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    detailEl.textContent = detail || 'Подготовка...';
  } else if (mode === 'error') {
    title.textContent = 'Ошибка';
    msg.textContent = detail || 'Не удалось установить FFmpeg.';
    row.classList.remove('hidden');
    wrap.classList.add('hidden');
    bar.style.width = '0%';
  }
}

async function handleInstallFFmpeg() {
  setFfmpegState('installing', 0, 'Начинаем загрузку...');
  try {
    await InstallFFmpeg();
    await checkFfmpeg();
  } catch (error) {
    setFfmpegState('error', 0, String(error));
  }
}

async function handlePickFFmpeg() {
  setFfmpegState('checking');
  try {
    const status = await PickFFmpeg();
    state.ffmpeg = status;
    state.ffmpegChecked = true;
    if (status.installed) {
      state.settings = await DefaultSettings();
      applySettings(state.settings);
    }
    renderFfmpeg();
  } catch (error) {
    setFfmpegState('error', 0, String(error));
  }
}

const PRESETS_KEY = 'gvc.presets';

function loadPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    return [];
  }
}

function savePresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function renderPresetSelect() {
  const presets = loadPresets();
  const select = document.getElementById('presetSelect');
  const current = select.value;
  select.innerHTML = '<option value="">Без пресета</option>' + presets.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  if (current !== '' && presets[current]) select.value = current;
}

function applyPreset(presets, index) {
  const preset = presets[index];
  if (!preset || !preset.settings) return;
  applySettings(preset.settings);
}

function savePreset(name, settings) {
  const presets = loadPresets();
  presets.push({ name, settings });
  savePresets(presets);
  renderPresetSelect();
  document.getElementById('presetSelect').value = String(presets.length - 1);
}

function deletePreset(index) {
  const presets = loadPresets();
  presets.splice(index, 1);
  savePresets(presets);
  renderPresetSelect();
}

function parsePresetFile(raw) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.presets) ? data.presets : null;
  if (!list) throw new Error('Файл не содержит пресетов (ожидался массив или поле "presets")');
  const clean = [];
  list.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '';
    const settings = item.settings && typeof item.settings === 'object' ? item.settings : null;
    if (name && settings) clean.push({ name, settings });
  });
  return clean;
}

async function exportPresets() {
  const presets = loadPresets();
  if (!presets.length) {
    showToast('Нет пресетов для экспорта', 'warn');
    return;
  }
  const payload = JSON.stringify({ app: 'GoVIDEOConverter', kind: 'presets', version: 1, presets }, null, 2);
  try {
    const saved = await ExportPresets(payload);
    if (saved) showToast(`Пресеты сохранены: ${saved}`);
  } catch (error) {
    showToast(`Ошибка экспорта: ${error}`, 'error');
  }
}

async function importPresets() {
  let raw;
  try {
    raw = await ImportPresets();
  } catch (error) {
    showToast(`Ошибка импорта: ${error}`, 'error');
    return;
  }
  if (!raw) return;
  let presets;
  try {
    presets = parsePresetFile(raw);
  } catch (error) {
    showToast(`Ошибка импорта: ${error.message}`, 'error');
    return;
  }
  if (!presets.length) {
    showToast('В файле нет корректных пресетов', 'warn');
    return;
  }
  const merged = loadPresets();
  presets.forEach(p => {
    const index = merged.findIndex(m => m.name.toLowerCase() === p.name.toLowerCase());
    if (index >= 0) merged[index] = p;
    else merged.push(p);
  });
  savePresets(merged);
  renderPresetSelect();
  showToast(`Импортировано пресетов: ${presets.length}`);
}

let toastTimer = null;
function showToast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function showPresetModal() {
  document.getElementById('presetNameInput').value = '';
  document.getElementById('presetModal').classList.remove('hidden');
  document.getElementById('presetNameInput').focus();
}

function hidePresetModal() {
  document.getElementById('presetModal').classList.add('hidden');
}

document.getElementById('startBtn').addEventListener('click', async () => {
  state.running = true;
  await StartProcessing(collectSettings());
});
['360','720','1080','2k','4k'].forEach(r => document.getElementById('res-' + r).addEventListener('change', onResolutionChange));
document.getElementById('container').addEventListener('change', event => {
  if (event.target.value === 'webm') {
    const codec = document.getElementById('codec');
    if (codec && codec.value !== 'vp9' && codec.value !== 'av1') codec.value = 'vp9';
  }
});
document.getElementById('presetSelect').addEventListener('change', event => {
  if (event.target.value !== '') applyPreset(loadPresets(), Number(event.target.value));
});
document.getElementById('presetSave').addEventListener('click', showPresetModal);
document.getElementById('presetImport').addEventListener('click', importPresets);
document.getElementById('presetExport').addEventListener('click', exportPresets);
document.getElementById('presetDelete').addEventListener('click', () => {
  const value = document.getElementById('presetSelect').value;
  if (value === '') return;
  deletePreset(Number(value));
});
document.getElementById('presetSaveOk').addEventListener('click', () => {
  const name = document.getElementById('presetNameInput').value.trim();
  if (!name) return;
  savePreset(name, collectSettings());
  hidePresetModal();
});
document.getElementById('presetSaveCancel').addEventListener('click', hidePresetModal);
document.getElementById('cancelBtn').addEventListener('click', () => CancelProcessing());
document.getElementById('clearBtn').addEventListener('click', async () => {
  await ClearFiles();
  state.files = [];
  state.selected = null;
  render();
});
document.getElementById('ffmpegBadge').addEventListener('click', checkFfmpeg);
document.getElementById('ffmpegInstallBtn').addEventListener('click', handleInstallFFmpeg);
document.getElementById('ffmpegPickBtn').addEventListener('click', handlePickFFmpeg);

const dropzone = document.getElementById('dropzone');
OnFileDrop((x, y, paths) => addPaths(paths), true);
dropzone.addEventListener('dragover', event => event.preventDefault());
dropzone.addEventListener('drop', event => event.preventDefault());
EventsOn('file-progress', updateFileProgress);
EventsOn('queue-add-progress', updateAddProgress);
EventsOn('processing-finished', async () => { state.running = false; state.files = await ListFiles(); render(); });
EventsOn('ffmpeg-install-progress', event => setFfmpegState('installing', event.progress, event.detail || event.phase));
  EventsOn('ffmpeg-installed', checkFfmpeg);

  EventsOn('preview-proxy-progress', onPreviewProxyProgress);

  EventsOn('update-status', updateStatus);
let updateTimer = null;

const UPDATE_ICONS = {
  spinner: '<svg class="spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40 20" /></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3v.01M12 3 2.5 20h19L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'
};

function updateStatus(ev) {
  if (!ev || !ev.status) return;
  const modal = document.getElementById('updateModal');
  const card = document.getElementById('updateCard');
  const bg = document.getElementById('updateBg');
  const icon = document.getElementById('updateIcon');
  const title = document.getElementById('updateTitle');
  const msg = document.getElementById('updateMsg');
  const detail = document.getElementById('updateDetail');
  const pct = document.getElementById('updatePct');
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
  const set = (t, m, d, p, ico, cls) => {
    modal.classList.remove('hidden');
    card.classList.remove('error', 'ok');
    if (cls) card.classList.add(cls);
    title.textContent = t;
    msg.textContent = m;
    detail.textContent = d || '';
    pct.textContent = p || '';
    icon.innerHTML = ico || '';
  };
  const full = () => {
    bg.classList.remove('indeterminate');
    bg.style.width = '100%';
  };
  if (ev.status === 'check') {
    bg.classList.add('indeterminate');
    bg.style.width = '';
    set('Проверка обновлений', `Текущая версия: v${ev.current || '-'}`, 'Подключение к серверу...', '', UPDATE_ICONS.spinner);
  } else if (ev.status === 'downloading') {
    bg.classList.remove('indeterminate');
    const pr = Math.max(0, Math.min(100, ev.progress || 0));
    bg.style.width = `${pr}%`;
    set('Доступно обновление', `Загружается версия v${ev.remote || ''}`, ev.detail || '', `${Math.round(pr)}%`, UPDATE_ICONS.download);
  } else if (ev.status === 'restarting') {
    full();
    set('Установка обновления', 'Файлы заменены, приложение перезапускается...', '', '100%', UPDATE_ICONS.spinner);
  } else if (ev.status === 'applied') {
    full();
    set('Обновление применено', `Установлена версия v${ev.current || ''}`, '', '', UPDATE_ICONS.check, 'ok');
    updateTimer = setTimeout(() => modal.classList.add('hidden'), 2000);
  } else if (ev.status === 'idle') {
    full();
    set('Версия актуальна', `Установлена актуальная версия v${ev.current || ''}`, '', '', UPDATE_ICONS.check, 'ok');
    updateTimer = setTimeout(() => modal.classList.add('hidden'), 2000);
  } else {
    full();
    set('Ошибка', ev.detail || 'Попробуйте позже', '', '', UPDATE_ICONS.alert, 'error');
    updateTimer = setTimeout(() => modal.classList.add('hidden'), 4500);
  }
}

seedResBitrates();
AppVersion().then(v => { document.getElementById('versionBadge').textContent = v ? `v${v}` : ''; });
CheckUpdates();
DefaultSettings().then(s => { state.settings = s; applySettings(s); });
CPUCount().then(cpus => {
  const el = document.getElementById('throttle');
  if (el) {
    el.max = cpus;
    if (!Number(el.value) || Number(el.value) > cpus) el.value = cpus;
  }
});
ListFiles().then(files => { state.files = files; render(); });
checkFfmpeg();
renderPresetSelect();
