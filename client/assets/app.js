/* ============================================================
   行测刷题 —— 应用逻辑
   纯前端、无依赖；数据用 <script> 动态注入，因此 file:// 双击即可用。
   ============================================================ */
'use strict';

const CAT = window.QB_CATALOG;
const POOL_INDEX = window.QB_POOL_INDEX || {};

/* ---------------------------------------------------------- 基础工具 */

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

function fmtDur(ms) {
  if (!ms || ms < 0) return '0秒';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '分' + String(s % 60).padStart(2, '0') + '秒';
  const h = Math.floor(m / 60);
  return h + '小时' + String(m % 60).padStart(2, '0') + '分';
}
const fmtSec = (ms) => (ms ? Math.round(ms / 1000) + 's' : '—');

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer;
function toast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* 复制到剪贴板（file:// 下 clipboard API 可能不可用，做降级） */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到降级方案 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);

/* ---------------------------------------------------------- 数据加载 */

const QMAP = new Map(); // qid -> question
const loadedKeys = new Set();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('无法加载 ' + src));
    document.head.appendChild(el);
  });
}

async function loadKey(src, key) {
  const id = src + ':' + key;
  if (loadedKeys.has(id)) return;
  if (src === 'p') {
    if (!(window.QB_PAPERS && window.QB_PAPERS[key])) await loadScript(`data/papers/${key}.js`);
    const pf = window.QB_PAPERS[key];
    if (!pf) throw new Error('套卷数据缺失: ' + key);
    for (const q of pf.questions) QMAP.set(q.qid, q);
  } else {
    if (!(window.QB_POOLS && window.QB_POOLS[key])) await loadScript(`data/pools/${key}.js`);
    const pl = window.QB_POOLS[key];
    if (!pl) throw new Error('题库数据缺失: ' + key);
    for (const q of pl.questions) QMAP.set(q.qid, q);
  }
  loadedKeys.add(id);
}

/** 保证 refs 里涉及的题目都在 QMAP 中 */
async function ensureQuestions(refs) {
  const todo = new Map();
  for (const r of refs) {
    if (!QMAP.has(r.qid)) todo.set(r.src + ':' + r.key, r);
  }
  for (const r of todo.values()) {
    // 同一套卷/同一池可以并行请求，这里串行足够快且更稳
    await loadKey(r.src, r.key);
  }
  return refs.map((r) => QMAP.get(r.qid)).filter(Boolean);
}

async function loadPaper(pid) {
  if (!(window.QB_PAPERS && window.QB_PAPERS[pid])) await loadScript(`data/papers/${pid}.js`);
  return window.QB_PAPERS[pid];
}

const paperById = new Map(CAT.papers.map((p) => [p.id, p]));
const yearOfPid = (pid) => paperById.get(pid)?.year ?? null;

/* ---------------------------------------------------------- 存储 */

const K = {
  settings: 'qb.settings.v1',
  active: 'qb.active.v1',
  sessions: 'qb.sessions.v1',
  wrong: 'qb.wrong.v1',
  favorites: 'qb.favorites.v1',
};

let memoryStore = null;
let storageOK = true;
try {
  localStorage.setItem('qb.__probe', '1');
  localStorage.removeItem('qb.__probe');
} catch {
  storageOK = false;
  memoryStore = {};
}

const store = {
  get(k, dflt) {
    try {
      const raw = storageOK ? localStorage.getItem(k) : memoryStore[k];
      return raw ? JSON.parse(raw) : dflt;
    } catch { return dflt; }
  },
  set(k, v) {
    const raw = JSON.stringify(v);
    try {
      if (storageOK) localStorage.setItem(k, raw);
      else memoryStore[k] = raw;
      window.CloudSync?.changed(k, v);
      return true;
    } catch (e) {
      toast('保存失败：本地存储已满，请在「记录」页删除一些旧记录', 4000);
      return false;
    }
  },
  del(k) {
    if (storageOK) localStorage.removeItem(k);
    else delete memoryStore[k];
    window.CloudSync?.changed(k, null);
  },
};

const DEFAULT_SETTINGS = { theme: 'auto', exportExpl: true, exportMat: true, exportScope: 'wrong+unanswered', paperSize: 19, autoPause: false };
let SETTINGS = { ...DEFAULT_SETTINGS, ...store.get(K.settings, {}) };
const saveSettings = () => store.set(K.settings, SETTINGS);

const MAX_SESSIONS = 150;
const getSessions = () => store.get(K.sessions, []);
function setSessions(list) {
  const compact = list.slice(0, MAX_SESSIONS).map((session) => {
    const { __questions, ...saved } = session;
    if (saved.meta) { const { rows, ...meta } = saved.meta; saved.meta = meta; }
    return saved;
  });
  return store.set(K.sessions, compact);
}
const getWrong = () => store.get(K.wrong, {});
const setWrong = (w) => store.set(K.wrong, w);

/* 收藏属于题目；复盘自评属于本次作答，两者不共用“待复查”标记。 */
const getFavorites = () => store.get(K.favorites, {});
function questionKey(q) {
  const normalize = h => stripTags(h).normalize('NFKC').replace(/\s+/g, '');
  const text = [normalize(q.material), normalize(q.stem), ...q.options.map(o => o.k + normalize(o.t))].join('\u001f');
  let h1 = 2166136261, h2 = 5381;
  for (const char of text) { h1 = Math.imul(h1 ^ char.charCodeAt(0), 16777619); h2 = Math.imul(h2, 33) ^ char.charCodeAt(0); }
  return 'f' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
const isFavorite = q => !!q && !!getFavorites()[questionKey(q)];
const FAMILIARITY = {first:'第一次做',forgot:'做过，忘了答案',remember:'做过，记得答案'};
const CONFIDENCE = {clear:'思路清楚',hesitant:'有犹豫',guess:'猜测 / 蒙的'};
function assessment(a, correct) {
  const review = a.review || {};
  const familiarity = FAMILIARITY[review.familiarity] || '未标注';
  const confidence = CONFIDENCE[review.confidence] || '未标注';
  let interpretation = !a.pick ? '未作答' : !correct ? '答错，需复盘' :
    review.familiarity === 'remember' ? '记得答案，独立解题能力待验证' :
    review.confidence === 'guess' ? '蒙对，掌握程度待验证' :
    review.confidence === 'hesitant' ? '答对但有犹豫，需巩固' :
    review.confidence === 'clear' ? '答对且自评思路清楚' : '答对但未自评，不能据此认定掌握';
  if (a.pick && !correct && review.confidence === 'guess') interpretation = '蒙错，需巩固';
  return {familiarity,confidence,interpretation};
}
function needsConsolidation(r) {
  return !r.correct || ['guess','hesitant'].includes(r.a.review?.confidence) || r.a.review?.familiarity === 'remember';
}
function favoriteButton(q, ref) {
  const on = isFavorite(q);
  return `<button class="btn btn-sm ${on ? 'btn-primary' : ''}" data-act="favorite" data-qid="${esc(ref.qid)}" data-src="${ref.src}" data-key="${esc(ref.key)}" aria-pressed="${on}">${on ? '已收藏' : '收藏'}</button>`;
}
function reviewControls(sess, ref, a, compact = false) {
  const group = (key, label, values) => `<div class="assessment-group"><b>${label}</b><div class="assessment-options">${Object.entries(values).map(([value, text]) =>
    `<button class="btn btn-sm ${a.review?.[key] === value ? 'btn-primary' : ''}" title="再点一次取消标注" aria-pressed="${a.review?.[key] === value}" data-act="review-label" data-sid="${esc(sess.id)}" data-qid="${esc(ref.qid)}" data-field="${key}" data-value="${value}">${text}</button>`).join('')}</div></div>`;
  const confidence = !compact && a.pick && a.pick === QMAP.get(ref.qid)?.answer ? {...CONFIDENCE,guess:'蒙对'} : CONFIDENCE;
  const reflection = `<label class="reflection-field"><span>我的复盘描述</span><textarea rows="3" data-act="review-description" data-sid="${esc(sess.id)}" data-qid="${esc(ref.qid)}" placeholder="记录当时的思路、犹豫点，或对答案的疑问……">${esc(a.reflection || '')}</textarea></label>`;
  const body = group('familiarity','是否做过',FAMILIARITY) + group('confidence','本次把握',confidence);
  return compact ? `<details class="assessment compact" data-assessment><summary>作答自评</summary>${body}</details>` :
    `<section class="assessment" data-assessment>${body}<p class="assessment-status">${esc(assessment(a,!!a.pick && a.pick === QMAP.get(ref.qid)?.answer).interpretation)}</p>${reflection}<span class="reflection-save" role="status">自动保存 · 导出时附上</span></section>`;
}

function saveReflection(sid, qid, value) {
  const list = getSessions();
  const active = S.session?.id === sid && !S.session.submitted;
  const sess = active ? S.session : list.find(s => s.id === sid);
  if (!sess || !sess.refs.some(r => r.qid === qid)) return false;
  const a = ansOf(sess, qid);
  a.reflection = value;
  a.reflectionUpdatedAt = Date.now();
  if (active) saveActive();
  else if (!setSessions(list)) return false;
  if (ExamTools.reviewSession?.id === sid) ExamTools.reviewSession = sess;
  return true;
}

function validSession(s) {
  return !!s && typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.refs) && s.refs.length > 0 &&
    s.refs.every(r => r && typeof r.qid === 'string' && ['p', 'q'].includes(r.src) && typeof r.key === 'string') &&
    Number.isInteger(s.index) && s.index >= 0 && s.index < s.refs.length &&
    s.answers && typeof s.answers === 'object' && !Array.isArray(s.answers);
}

/* ---------------------------------------------------------- 会话 */

let S = { session: null, shownAt: 0, revealedCache: new Set(), pendingSession: null };

function newId() {
  return 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function makeRef(q, src, key) {
  return { qid: q.qid, src, key, type: q.type, module: q.module, no: q.no };
}

const ansOf = (sess, qid) => (sess.answers[qid] ||= { pick: '', ms: 0, flagged: false, submitted: false });

function startSession(sess) {
  if (S.session && !S.session.submitted) {
    flushTime(); saveActive();
    S.pendingSession = sess;
    MODAL = modal('已有未完成的练习', '<p>开始新练习会替换当前进度。可以先继续并交卷，或备份当前进度后再开始。</p>',
      '<button class="btn" data-act="close-modal">保留当前练习</button><button class="btn" data-act="backup">导出备份</button><button class="btn btn-primary" data-act="replace-session">开始新练习</button>');
    render(); return;
  }
  S.session = sess;
  S.shownAt = 0;
  store.set(K.active, sess);
  go('#/quiz');
}

function saveActive() {
  // A second tab may have handed in this same session already.
  if (!S.session || S.session.submitted || getSessions().some(s => s.id === S.session.id)) return;
  flushTime();
  store.set(K.active, S.session);
}

function flushTime() {
  const sess = S.session;
  if (!sess || sess.submitted || !S.shownAt) return;
  const ref = sess.refs[sess.index];
  if (!ref) return;
  const a = ansOf(sess, ref.qid);
  const now = performance.now();
  const dt = now - S.shownAt;
  if (dt > 0) a.ms += dt;
  S.shownAt = now;
}

const fmtClock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function liveTime() {
  const sess = S.session;
  if (!sess) return { total: 0, current: 0 };
  const delta = S.shownAt ? Math.max(0, performance.now() - S.shownAt) : 0;
  return {
    total: Object.values(sess.answers).reduce((n, a) => n + (a.ms || 0), 0) + delta,
    current: (sess.answers[sess.refs[sess.index]?.qid]?.ms || 0) + delta,
  };
}

function syncClock() {
  const canRun = route.name === 'quiz' && S.session && !S.session.submitted && !S.session.paused && !$('.modal-bg') && !(SETTINGS.autoPause && document.hidden);
  if (!canRun) { flushTime(); S.shownAt = 0; }
  else if (!S.shownAt) S.shownAt = performance.now();
  const time = liveTime();
  for (const [key, ms] of Object.entries(time)) {
    const el = $(`[data-clock="${key}"]`);
    if (el) el.textContent = fmtClock(ms);
  }
}

/** 一组题目的统计 */
function summarize(sess, questions) {
  const qByQid = new Map(questions.map((q) => [q.qid, q]));
  const rows = sess.refs.map((ref) => {
    const q = qByQid.get(ref.qid);
    const a = sess.answers[ref.qid] || {};
    const correct = !!(a.pick && q && a.pick === q.answer);
    return { ref, q, a, correct, answered: !!a.pick };
  });
  const answered = rows.filter((r) => r.answered);
  const right = rows.filter((r) => r.correct);
  const byType = new Map();
  for (const r of rows) {
    const t = r.ref.type || '未分类';
    if (!byType.has(t)) byType.set(t, { type: t, n: 0, ans: 0, ok: 0, ms: 0 });
    const b = byType.get(t);
    b.n++;
    if (r.answered) b.ans++;
    if (r.correct) b.ok++;
    b.ms += r.a.ms || 0;
  }
  const types = CAT.typeOrder.filter((t) => byType.has(t)).concat([...byType.keys()].filter((t) => !CAT.typeOrder.includes(t)));
  return {
    rows,
    total: rows.length,
    answered: answered.length,
    unanswered: rows.length - answered.length,
    right: right.length,
    wrong: answered.length - right.length,
    accuracy: answered.length ? right.length / answered.length : 0,
    totalMs: rows.reduce((s, r) => s + (r.a.ms || 0), 0),
    byType: types.map((t) => byType.get(t)),
  };
}

/* ---------------------------------------------------------- 报告 / 导出 */

const TYPE_MODULE = CAT.typeModule || {};
const moduleOfType = (t) => TYPE_MODULE[t] || '';
/** 平均每题用时：一道都没作答时显示 —，不要拿「停留时间」冒充 */
const avgSec = (ms, n) => (n ? fmtSec(ms / n) : '—');

function exportRows(sess, questions, scope) {
  const { rows } = summarize(sess, questions);
  if (scope === 'wrong') return rows.filter((r) => r.answered && !r.correct);
  if (scope === 'unanswered') return rows.filter((r) => !r.answered);
  if (scope === 'wrong+unanswered') return rows.filter((r) => !r.correct);
  if (scope === 'consolidate') return rows.filter(needsConsolidation);
  return rows;
}

const stripTags = (h) =>
  String(h || '')
    .replace(/<span\b[^>]*class="exam-ellipsis"[^>]*>[\s\S]*?<\/span>/gi, '……')
    .replace(/<span\b[^>]*class="exam-blank"[^>]*>[\s\S]*?<\/span>/gi, '________')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (m, s) => `![图片](${s})`)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const questionExcerpt = q => stripTags(q.stem).replace(/!\[[^\]]*\]\([^)]+\)/g, '〔图片〕').slice(0,110);

function htmlToMd(html, indent = '') {
  // 保留段落结构，图片转 Markdown 语法
  return String(html || '')
    .replace(/<span\b[^>]*class="exam-ellipsis"[^>]*>[\s\S]*?<\/span>/gi, '……')
    .replace(/<span\b[^>]*class="exam-blank"[^>]*>[\s\S]*?<\/span>/gi, '________')
    .split(/<\/p>|<br\s*\/?>/i)
    .map((seg) =>
      seg
        .replace(/<img[^>]*src="([^"]+)"[^>]*class="tex"[^>]*>/gi, (m, s) => `![公式](${s})`)
        .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (m, s) => `![图](${s})`)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .trim())
    .filter(Boolean)
    .map((l) => indent + l)
    .join('\n\n');
}

function buildMarkdown(sessions, opts = {}) {
  const { expl = true, material = true, scope = 'wrong' } = opts;
  const out = [];
  out.push('# 行测刷题记录');
  out.push('');
  out.push(`> 导出时间：${fmtTime(Date.now())}　共 ${sessions.length} 次练习`);
  out.push('>');
  out.push('> 图片：Markdown 使用相对路径；下载「Markdown + 图片」并解压后即可显示。直接复制文字不会传送图片，图形题建议另附图片或上传带图 PDF。');
  out.push('> 自评按本次作答保存。答对不等于掌握：蒙对、有犹豫、记得答案须单独分析；未标注不能当作思路清楚。思路清楚也是考生自评，不是已验证的长期掌握。');
  out.push('> 复盘描述为考生自述，请结合实际题干和解析核验；对答案有疑问不代表答案必然有错。');
  out.push('');

  // 跨会话汇总
  if (sessions.length > 1) {
    out.push('## 全部练习汇总');
    out.push('');
    out.push('| # | 时间 | 类型 | 名称 | 题量 | 作答 | 正确 | 错误 | 正确率 | 用时 |');
    out.push('|---|---|---|---|---|---|---|---|---|---|');
    sessions.forEach((s, i) => {
      const m = s.meta || {};
      out.push(`| ${i + 1} | ${fmtTime(s.submittedAt || s.createdAt)} | ${s.kind === 'paper' ? '套卷' : s.kind === 'wrong' ? '错题重刷' : '随机'} | ${s.title} | ${m.total} | ${m.answered} | ${m.right} | ${m.wrong} | ${pct(m.right, m.answered)} | ${fmtDur(m.totalMs)} |`);
    });
    out.push('');
    // 题型维度跨会话
    const agg = new Map();
    for (const s of sessions) for (const t of s.meta?.byType || []) {
      if (!agg.has(t.type)) agg.set(t.type, { type: t.type, n: 0, ans: 0, ok: 0, ms: 0 });
      const b = agg.get(t.type);
      b.n += t.n; b.ans += t.ans; b.ok += t.ok; b.ms += t.ms;
    }
    if (agg.size) {
      out.push('## 跨练习·分题型汇总');
      out.push('');
      out.push('| 题型 | 所属模块 | 题量 | 作答 | 正确 | 错误 | 正确率 | 平均用时 |');
      out.push('|---|---|---|---|---|---|---|---|');
      for (const t of CAT.typeOrder.filter((x) => agg.has(x))) {
        const b = agg.get(t);
        out.push(`| ${b.type} | ${moduleOfType(b.type)} | ${b.n} | ${b.ans} | ${b.ok} | ${b.ans - b.ok} | ${pct(b.ok, b.ans)} | ${avgSec(b.ms, b.ans)} |`);
      }
      out.push('');
    }
    out.push('---');
    out.push('');
  }

  for (const sess of sessions) {
    const m = sess.meta || {};
    const qs = sess.__questions || [];
    out.push(`# ${sess.kind === 'paper' ? '套卷练习' : sess.kind === 'wrong' ? '错题重刷' : sess.kind === 'favorites' ? '收藏重刷' : '随机练习'}：${sess.title}`);
    out.push('');
    out.push(`- 时间：${fmtTime(sess.createdAt)} → ${fmtTime(sess.submittedAt || Date.now())}`);
    out.push(`- 题量：${m.total}　作答：${m.answered}　未答：${m.unanswered}`);
    out.push(`- 正确：${m.right}　错误：${m.wrong}　正确率：${pct(m.right, m.answered)}（按已作答计）`);
    out.push(`- 答题总用时：${fmtDur(m.totalMs)}　平均每题：${fmtSec(m.totalMs / (m.answered || m.total || 1))}`);
    const reviewRows = summarize(sess, qs).rows;
    out.push(`- 自评统计：蒙对 ${reviewRows.filter(r => r.correct && r.a.review?.confidence === 'guess').length}；答对但犹豫 ${reviewRows.filter(r => r.correct && r.a.review?.confidence === 'hesitant').length}；记得答案 ${reviewRows.filter(r => r.a.review?.familiarity === 'remember').length}；答对且思路清楚 ${reviewRows.filter(r => r.correct && r.a.review?.confidence === 'clear' && r.a.review?.familiarity !== 'remember').length}；已答但未标注把握 ${reviewRows.filter(r => r.answered && !CONFIDENCE[r.a.review?.confidence]).length}`);
    out.push('');
    out.push('## 分题型表现');
    out.push('');
    out.push('| 题型 | 所属模块 | 题量 | 作答 | 正确 | 错误 | 正确率 | 平均用时 |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const t of m.byType || []) {
      out.push(`| ${t.type} | ${moduleOfType(t.type)} | ${t.n} | ${t.ans} | ${t.ok} | ${t.ans - t.ok} | ${pct(t.ok, t.ans)} | ${avgSec(t.ms, t.ans)} |`);
    }
    out.push('');

    const rows = exportRows(sess, qs, scope);
    const label = scope === 'all' ? '全部题目明细' : scope === 'consolidate' ? '需巩固题目（含蒙对、犹豫、记得答案）' : scope === 'wrong' ? '错题明细' : scope === 'unanswered' ? '未作答题目' : '错题与未作答明细';
    out.push(`## ${label}（${rows.length} 题）`);
    out.push('');
    if (!rows.length) out.push('_（无）_');
    rows.forEach((r, i) => {
      const q = r.q;
      out.push(`### ${i + 1}. ${r.ref.type || '未分类'} · 第 ${r.ref.no} 题　\`qid ${r.ref.qid}\``);
      out.push('');
      if (q && material && q.material) {
        out.push('**材料**');
        out.push('');
        out.push(htmlToMd(q.material, '> ') || '> ');
        out.push('');
      }
      out.push('**题干**');
      out.push('');
      out.push(q ? htmlToMd(q.stem) : '_（题目内容未能加载）_');
      out.push('');
      if (q) {
        out.push('**选项**');
        out.push('');
        for (const o of q.options) out.push(`- ${o.k}. ${htmlToMd(o.t).replace(/\n+/g, ' ')}`);
        out.push('');
      }
      const a = r.a;
      const review = assessment(a, r.correct);
      out.push(`**是否做过**：${review.familiarity}　**本次把握**：${review.confidence}`, '');
      out.push(`**复盘提示**：${review.interpretation}　**收藏**：${isFavorite(q) ? '是' : '否'}　**待复查标记**：${a.flagged ? '是' : '否'}`, '');
      const mine = a.pick || '（未作答）';
      const mark = !a.pick ? '⬜未答' : r.correct ? '✅' : '❌';
      out.push(`**我的答案**：${mine} ${mark}　**正确答案**：${q ? q.answer : '?'}　**用时**：${fmtSec(a.ms)}`);
      out.push('');
      if (a.excluded) out.push(`**曾排除选项**：${a.excluded}`, '');
      if (a.note) out.push('**我的草稿 / 思路**', '', a.note, '');
      if (a.reflection) out.push('**我的复盘描述（考生自述）**', '', a.reflection, '');
      if (expl && q && q.explanation) {
        out.push('**官方解析**');
        out.push('');
        out.push(htmlToMd(q.explanation, '> ') || '> ');
        out.push('');
      }
      out.push('---');
      out.push('');
    });
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

function buildJson(sessions, opts = {}) {
  const payload = {
    app: '行测刷题',
    exportedAt: new Date().toISOString(),
    yearRange: CAT.yearRange,
    modules: CAT.modules,
    options: opts,
    sessions: sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      paperId: s.paperId || null,
      createdAt: s.createdAt,
      submittedAt: s.submittedAt || null,
      summary: s.meta,
      questions: exportRows(s, s.__questions || [], opts.scope).map((r) => ({
        qid: r.ref.qid,
        type: r.ref.type,
        module: r.ref.module,
        no: r.ref.no,
        stem: r.q ? stripTags(r.q.stem) : null,
        material: opts.material && r.q?.material ? stripTags(r.q.material) : undefined,
        options: r.q ? r.q.options.map((o) => ({ key: o.k, text: stripTags(o.t) })) : [],
        myAnswer: r.a.pick || null,
        correctAnswer: r.q ? r.q.answer : null,
        correct: r.correct,
        timeMs: r.a.ms || 0,
        excludedOptions: r.a.excluded || '',
        note: r.a.note || '',
        reflection: r.a.reflection || '',
        reflectionUpdatedAt: r.a.reflectionUpdatedAt || null,
        annotations: r.a.annotations || undefined,
        selfAssessment: { codes: r.a.review || {}, ...assessment(r.a, r.correct) },
        needsConsolidation: needsConsolidation(r),
        favorite: isFavorite(r.q),
        flaggedForReview: !!r.a.flagged,
        explanation: opts.expl && r.q ? stripTags(r.q.explanation) : undefined,
      })),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** 组装导出用的会话（补上 meta 与题目对象） */
async function prepareForExport(sessions) {
  const out = [];
  for (const s of sessions) {
    const qs = await ensureQuestions(s.refs);
    out.push({ ...s, __questions: qs, meta: s.meta || summarize(s, qs) });
  }
  return out;
}

/* ---------------------------------------------------------- 随机抽样 */

function loadPools(types) {
  return Promise.all(
    types.map(async (t) => {
      const info = POOL_INDEX[t];
      if (!info) return { type: t, questions: [] };
      if (!(window.QB_POOLS && window.QB_POOLS[info.key])) await loadScript(`data/pools/${info.key}.js`);
      return window.QB_POOLS[info.key] || { type: t, questions: [] };
    }));
}

/** 在选中题型之间按可用量比例分配题数，并返回实际抽样结果 */
function allocate(types, poolSizes, total) {
  const avail = types.map((t) => poolSizes[t] || 0);
  const sum = avail.reduce((a, b) => a + b, 0);
  if (!sum) return types.map(() => 0);
  const want = avail.map((a) => Math.floor((a / sum) * total));
  let left = total - want.reduce((a, b) => a + b, 0);
  // 余数按小数部分从大到小补
  const frac = avail.map((a, i) => ({ i, f: (a / sum) * total - want[i] })).sort((x, y) => y.f - x.f);
  for (const { i } of frac) {
    if (left <= 0) break;
    if (want[i] < avail[i]) { want[i]++; left--; }
  }
  // 还不够就突破比例，往未取满的池里加
  for (let i = 0; i < want.length && left > 0; i++) {
    const room = avail[i] - want[i];
    const add = Math.min(room, left);
    want[i] += add; left -= add;
  }
  return want;
}

function shuffle(arr, seed) {
  // xorshift，保证同一 seed 可复现
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------- 视图状态 */

const V = {
  paperFilter: { year: '', region: '', q: '', type: '', sort: 'year' },
  /** 卷详情页里已勾选的题型：{ [pid]: Set<题型> } */
  paperSel: {},
  custom: {
    types: new Set(),
    total: 30,
    years: new Set(Array.from({ length: CAT.yearRange[1] - CAT.yearRange[0] + 1 }, (_, i) => String(CAT.yearRange[0] + i))),
  },
  historySel: new Set(),
  wrongFilter: '',
  reportScope: null,
  showAllExpl: false,
  busy: false,
};

let route = { name: 'home', args: [] };

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { name: parts[0] || 'home', args: parts.slice(1), query };
}

/* ---------------------------------------------------------- 通用片段 */

function topbar(active) {
  const link = (href, label, key) =>
    `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<div class="topbar">
    <a class="brand" href="#/">行测练习室</a>
    <div class="spacer"></div>
    ${window.CloudSync?.statusHtml() || ''}
    <div class="navlinks">
      ${link('#/', '首页', 'home')}
      ${link('#/papers', '真题套卷', 'papers')}
      ${link('#/custom', '专项训练', 'custom')}
      ${link('#/wrong', '错题本', 'wrong')}
      ${link('#/favorites', '收藏题', 'favorites')}
      ${link('#/history', '练习记录', 'history')}
    </div>
  </div>`;
}

const emptyBox = (icon, title, desc) =>
  `<div class="empty"><div style="font-weight:600;color:var(--text)">${title}</div><div class="small" style="margin-top:6px">${desc}</div></div>`;

// Display titles are compact; the original title remains in records and exports.
function displayTitle(title) {
  return String(title || '').replace(/（网友回忆版）|\(网友回忆版\)/g, '').replace(/公务员录用考试/g, '').replace(/《行测》题/g, '行测').replace(/\s*·\s*/g, ' · ').trim();
}

/* ---------------------------------------------------------- 视图：首页 */

function viewHome() {
  const sessions = getSessions();
  const storedActive = store.get(K.active, null);
  const active = storedActive && !sessions.some(s => s.id === storedActive.id) ? storedActive : null;
  const wrongN = Object.keys(getWrong()).length;
  const answered = sessions.reduce((n,s) => n + (s.meta?.answered || 0), 0);
  const right = sessions.reduce((n,s) => n + (s.meta?.right || 0), 0);
  return `${topbar('home')}
  <main class="home-workspace">
    <header class="home-heading"><div class="home-intro"><h1 class="home-title"><img src="assets/home-title.svg" alt="两眼一睁就是练" width="1723" height="352"></h1><p>真题、专项与复盘，在这里完成。</p></div>
      <div class="learning-summary"><div><b>${sessions.length}</b><span>完成练习</span></div><div><b>${answered ? pct(right,answered) : '—'}</b><span>累计正确率</span></div></div>
    </header>
    ${active && !active.submitted ? `<section class="resume-strip"><div><b>继续上次练习</b><p title="${esc(active.title)}">${esc(displayTitle(active.title))} · 第 ${active.index + 1} / ${active.refs.length} 题</p></div><div class="row"><button class="btn btn-ghost" data-act="discard-active">放弃</button><button class="btn btn-primary" data-act="resume">继续作答</button></div></section>` : ''}
    <section class="practice-grid" aria-label="练习方式">
      <a class="practice-main" href="#/papers"><div><span class="entry-label">${CAT.yearRange[0]}—${CAT.yearRange[1]} 年真题</span><h2>真题套卷</h2><p>选一份试卷，进入考试状态。</p></div><div class="entry-bottom"><span>${CAT.totalPapers} 套试卷</span><span class="entry-action">选择试卷</span></div></a>
      <a class="practice-side" href="#/custom"><div><h2>专项训练</h2><p>按题型集中练习。</p></div><span class="entry-action">选择题型</span></a>
      <a class="practice-side" href="#/wrong"><div><h2>错题复习</h2><p>${wrongN ? wrongN + ' 道错题，等待重新掌握。' : '把每一次失误变成进步。'}</p></div><span class="entry-action">打开错题本</span></a>
    </section>
    <section class="recent-section"><div class="section-heading"><h2>最近练习</h2><a href="#/history">全部记录</a></div>
      ${sessions.length ? `<div class="recent-list">${sessions.slice(0,4).map(s => `<a class="recent-row" href="#/report/${s.id}"><div><b title="${esc(s.title)}">${esc(displayTitle(s.title))}</b><span>${fmtTime(s.submittedAt || s.createdAt)} · ${s.meta?.total ?? s.refs.length} 题</span></div><strong>${pct(s.meta?.right,s.meta?.answered)}</strong><span class="recent-duration">${fmtDur(s.meta?.totalMs)}</span></a>`).join('')}</div>` : '<div class="recent-empty">完成一次练习后，成绩会保存在这里。</div>'}
    </section>
    <footer class="workspace-footer">政治理论 · 言语理解与表达 · 判断推理<span>${CAT.totalQuestions.toLocaleString()} 道真题</span></footer>
    ${!storageOK ? '<div class="card card-pad">本地存储不可用，刷新会丢失记录。请用「启动.cmd」打开。</div>' : ''}
  </main>`;
}

/* ---------------------------------------------------------- 视图：套卷列表 */

/** 一套卷里每个模块各有多少题 */
function moduleCounts(paper) {
  const out = new Map();
  for (const [t, n] of Object.entries(paper.types)) {
    const m = moduleOfType(t) || '其他';
    out.set(m, (out.get(m) || 0) + n);
  }
  return out;
}

/** 该卷各模块的题量，按卷面顺序 */
function moduleList(paper) {
  const mc = moduleCounts(paper);
  return CAT.modules.filter((m) => mc.has(m)).map((m) => ({ m, n: mc.get(m) }));
}

/** 卷详情页的勾选状态，默认全选 */
function paperSelOf(pf) {
  if (!V.paperSel[pf.id]) V.paperSel[pf.id] = new Set(Object.keys(pf.types));
  return V.paperSel[pf.id];
}

function viewPapers() {
  const f = V.paperFilter;
  const years = [...new Set(CAT.papers.map((p) => p.year))].sort((a, b) => b - a);
  const regions = [...new Set(CAT.papers.map((p) => p.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));

  let list = CAT.papers.slice();
  if (f.year) list = list.filter((p) => String(p.year) === f.year);
  if (f.region) list = list.filter((p) => p.region === f.region);
  if (f.type) list = list.filter((p) => p.types[f.type]);
  if (f.q) {
    const kw = f.q.trim().toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(kw));
  }
  if (f.sort === 'count') list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  else list.sort((a, b) => (b.year - a.year) || a.name.localeCompare(b.name, 'zh'));

  const seg = (name, val, cur, label) =>
    `<button class="btn btn-sm ${String(cur) === String(val) ? 'btn-primary' : ''}" data-act="pf" data-k="${name}" data-v="${esc(val)}">${esc(label)}</button>`;

  const cards = list.map((p) => {
    const mods = moduleList(p);
    return `<div class="paper" data-act="open-paper" data-id="${p.id}">
      <div class="ttl" title="${esc(p.name)}">${esc(displayTitle(p.name))}</div>
      <div class="meta">
        <span class="chip acc">${p.year}</span>
        ${p.region ? `<span class="chip">${esc(p.region)}</span>` : ''}
        <span class="chip">${p.count} 题</span>
      </div>
      <div class="modstart">
        ${mods.map((x) => `<button class="btn btn-sm" data-act="start-paper-module" data-id="${p.id}" data-m="${esc(x.m)}" title="只做本卷的${esc(x.m)}">${esc(x.m)} <b>${x.n}</b></button>`).join('')}
        <button class="btn btn-sm" data-act="open-paper" data-id="${p.id}">自选题型</button>
      </div>
    </div>`;
  }).join('');

  return `${topbar('papers')}
  <header class="page-heading"><h1>真题套卷</h1><p>选年份、地区，找到你要练的试卷。</p></header>
  <div class="card card-pad paper-filters">
    <div class="filters">
      <div class="seg">${seg('year', '', f.year, '全部')}${years.map((y) => seg('year', y, f.year, y)).join('')}</div>
      <div class="right row">
        <select data-act="pf-sel" data-k="region">
          <option value="">全部地区</option>
          ${regions.map((r) => `<option value="${esc(r)}" ${f.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select>
        <select data-act="pf-sel" data-k="type">
          <option value="">全部题型</option>
          ${CAT.typeOrder.map((t) => `<option value="${esc(t)}" ${f.type === t ? 'selected' : ''}>${esc(t)}（${CAT.typeCount[t]}）</option>`).join('')}
        </select>
        <select data-act="pf-sel" data-k="sort">
          <option value="year" ${f.sort === 'year' ? 'selected' : ''}>按年份</option>
          <option value="count" ${f.sort === 'count' ? 'selected' : ''}>按题量</option>
        </select>
        <input type="search" placeholder="搜索卷名…" value="${esc(f.q)}" data-act="pf-q" style="width:180px">
      </div>
    </div>
  </div>

  <div class="listbar">
    <span>共 <b>${list.length}</b> 套卷 · <b>${list.reduce((s, p) => s + p.count, 0).toLocaleString()}</b> 题</span>
    
    <div class="right"><button class="btn btn-sm btn-ghost" data-act="quiz-random-paper">随机抽一套</button></div>
  </div>

  ${list.length ? `<div class="paper-list">${cards}</div>` : emptyBox(ExamTools.icon('file'), '没有匹配的套卷', '换个筛选条件试试')}`;
}

/* ---------------------------------------------------------- 视图：卷详情 */

async function viewPaper(pid) {
  const meta = paperById.get(pid);
  if (!meta) return `${topbar('papers')}${emptyBox(ExamTools.icon('file'), '找不到这套卷', '')}`;
  const pf = await loadPaper(pid);
  for (const q of pf.questions) QMAP.set(q.qid, q);
  const sel = paperSelOf(pf);
  const mods = moduleList(pf);

  const chosenCount = Object.entries(pf.types)
    .filter(([t]) => sel.has(t))
    .reduce((s, [, n]) => s + n, 0);

  const moduleBlock = mods.map(({ m, n }) => {
    const types = CAT.typeOrder.filter((t) => pf.types[t] && moduleOfType(t) === m);
    const chosen = types.filter((t) => sel.has(t));
    const modOn = chosen.length === types.length && types.length > 0;
    return `<div class="pickmod ${modOn ? 'on' : ''}">
      <div class="pickmod-h">
        <label class="check ${modOn ? 'on' : ''}" style="padding-left:4px">
          <input type="checkbox" data-act="psel-module" data-id="${pid}" data-m="${esc(m)}" ${modOn ? 'checked' : ''}>
          <b>${esc(m)}</b>
        </label>
        <span class="chip">已选 ${chosen.reduce((s, t) => s + pf.types[t], 0)} / ${n} 题</span>
        <div class="right row">
          <button class="btn btn-sm btn-ghost" data-act="psel-module-only" data-id="${pid}" data-m="${esc(m)}">只做这个模块</button>
        </div>
      </div>
      <div class="row" style="margin-top:4px">
        ${types.map((t) => `<label class="check ${sel.has(t) ? 'on' : ''}">
          <input type="checkbox" data-act="psel-type" data-id="${pid}" data-t="${esc(t)}" ${sel.has(t) ? 'checked' : ''}>
          ${esc(t)} <span class="n">${pf.types[t]}</span></label>`).join('')}
      </div>
    </div>`;
  }).join('');

  return `${topbar('papers')}
  <div class="crumb"><a href="#/papers">套卷刷题</a><span>/</span><span class="muted">卷目详情</span></div>

  <div class="card card-pad">
    <h1 style="font-size:19px">${esc(pf.name)}</h1>
    <div class="row" style="margin-top:12px">
      <span class="chip acc">${pf.year}</span>
      ${pf.region ? `<span class="chip">${esc(pf.region)}</span>` : ''}
      <span class="chip">全卷 ${pf.count} 题</span>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h3>选择练习内容</h3>
      <div class="spacer"></div>
      <button class="btn btn-sm" data-act="psel-all" data-id="${pid}">全选</button>
      <button class="btn btn-sm" data-act="psel-none" data-id="${pid}">清空</button>
    </div>
    <div class="card-pad col" style="gap:12px">${moduleBlock}</div>
  </div>

  <div class="card card-pad startbar">
    <div>
      <div style="font-weight:600">已选 <span class="bigcount">${chosenCount}</span> 题${chosenCount !== pf.count ? `<span class="muted small">（全卷 ${pf.count} 题）</span>` : ''}</div>
    </div>
    <div class="right row">
      ${mods.map(({ m }) => `<button class="btn btn-sm" data-act="psel-module-only" data-id="${pid}" data-m="${esc(m)}">只做${esc(m)}</button>`).join('')}
      <button class="btn" data-act="print-questions" data-source="paper" data-id="${pid}" ${chosenCount ? '' : 'disabled'}>打印试题</button>
      <button class="btn" data-act="download-questions" data-source="paper" data-id="${pid}" ${chosenCount ? '' : 'disabled'}>导出打印版</button>
      <button class="btn" data-act="download-question-pdf" data-source="paper" data-id="${pid}" ${chosenCount ? '' : 'disabled'}>下载试题 PDF</button>
      <button class="btn btn-lg btn-primary" data-act="start-paper-part" data-id="${pid}" ${chosenCount ? '' : 'disabled'}>开始刷题</button>
    </div>
  </div>

  `;
}

/* ---------------------------------------------------------- 视图：随机刷题 */

function viewCustom() {
  const c = V.custom;
  const poolSizes = {};
  const selectedMask = [...c.years].reduce((mask, y) => mask | (1 << (+y - CAT.yearRange[0])), 0);
  for (const t of CAT.typeOrder) {
    const info = POOL_INDEX[t];
    poolSizes[t] = info?.yearMasks && selectedMask
      ? Object.entries(info.yearMasks).reduce((n, [mask, count]) => n + ((+mask & selectedMask) ? count : 0), 0)
      : info?.count || 0;
  }

  const years = Array.from({ length: CAT.yearRange[1] - CAT.yearRange[0] + 1 }, (_, i) => String(CAT.yearRange[0] + i));
  const selected = [...c.types];
  const alloc = allocate(selected, poolSizes, Math.min(c.total, selected.reduce((s, t) => s + (poolSizes[t] || 0), 0)));
  const allocMap = Object.fromEntries(selected.map((t, i) => [t, alloc[i]]));
  const realTotal = alloc.reduce((a, b) => a + b, 0);
  const maxTotal = selected.reduce((s, t) => s + (poolSizes[t] || 0), 0);

  const byModule = new Map();
  for (const t of CAT.typeOrder) {
    const m = moduleOfType(t);
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m).push(t);
  }

  return `${topbar('custom')}
  <header class="page-heading"><h1>专项训练</h1><p>选择题型，集中突破。</p></header>

  <div class="card card-pad" style="margin-top:18px">
    <div class="field"><span class="lbl">1. 选择题型（可多选）</span>
      ${[...byModule.entries()].map(([m, ts]) => `<div style="margin-top:8px">
        <div class="tiny muted" style="margin-bottom:6px">${esc(m)}</div>
        <div class="row">${ts.map((t) => `<label class="check ${c.types.has(t) ? 'on' : ''}">
          <input type="checkbox" data-act="ct" data-t="${esc(t)}" ${c.types.has(t) ? 'checked' : ''}>
          ${esc(t)} <span class="n">${poolSizes[t]}</span></label>`).join('')}</div>
      </div>`).join('')}
      <div class="row" style="margin-top:10px">
        <button class="btn btn-sm btn-ghost" data-act="ct-all">全选</button>
        <button class="btn btn-sm btn-ghost" data-act="ct-none">清空</button>
        <button class="btn btn-sm btn-ghost" data-act="ct-module" data-m="言语理解与表达">只选言语</button>
        <button class="btn btn-sm btn-ghost" data-act="ct-module" data-m="判断推理">只选判断</button>
        <button class="btn btn-sm btn-ghost" data-act="ct-module" data-m="政治理论">只选政治理论</button>
      </div>
    </div>
  </div>

  <div class="card card-pad">
    <div class="field"><span class="lbl">2. 题量</span>
      <div class="row">
        <input type="number" min="1" max="${maxTotal || 1}" value="${c.total}" data-act="ctotal" style="width:110px">
        ${[10, 20, 30, 50, 100].map((n) => `<button class="btn btn-sm" data-act="ctotal-set" data-n="${n}">${n}</button>`).join('')}
        <span class="small muted">可选上限 ${maxTotal}</span>
      </div>
    </div>
    <div class="field" style="margin-top:16px"><span class="lbl">3. 年份范围（全部取消时不限年份）</span>
      <div class="row">${years.map((y) => `<label class="check ${c.years.has(y) ? 'on' : ''}">
        <input type="checkbox" data-act="cy" data-y="${y}" ${c.years.has(y) ? 'checked' : ''}>${y}</label>`).join('')}</div>
    </div>
  </div>

  <div class="card card-pad">
    <div class="row"><b>本次将抽取</b><span class="chip acc">${realTotal} 题</span>
      ${realTotal < c.total ? `<span class="small" style="color:var(--warn)">（受所选题型题量上限限制，实际少于 ${c.total}）</span>` : ''}
    </div>
    ${selected.length ? `<table class="tbl pv" style="margin-top:10px">
      <thead><tr><th>题型</th><th>所属模块</th><th class="num">可用</th><th class="num">抽取</th></tr></thead>
      <tbody>${selected.map((t) => `<tr><td>${esc(t)}</td><td class="dim">${esc(moduleOfType(t))}</td><td class="num muted">${poolSizes[t]}</td><td class="num"><b>${allocMap[t]}</b></td></tr>`).join('')}</tbody>
    </table>` : '<div class="small muted" style="margin-top:8px">请先选择题型</div>'}
    <div class="row" style="margin-top:18px">
      <button class="btn btn-lg btn-primary" data-act="start-custom" ${realTotal ? '' : 'disabled'}>开始刷题</button>
      <span class="small muted">交卷后才能查看答案与解析</span>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- 视图：答题 */

/** 答题中：不做任何对错提示，交卷后才复盘 */
function renderQuestion(q, ref, a) {
  const pick = a.pick || '';
  const isMulti = q.multi;

  const optHtml = q.options.map((o) => {
    const sel = pick.includes(o.k);
    const excluded = (a.excluded || '').includes(o.k);
    return `<div class="opt ${sel ? 'sel' : ''} ${excluded ? 'excluded' : ''}" data-act="pick" data-k="${o.k}" tabindex="0" role="checkbox" aria-checked="${sel}" aria-label="选项 ${o.k}${excluded ? '，已排除' : ''}">
      <div class="k">${o.k}</div><div class="t" data-mark-zone="opt-${o.k}">${o.t}</div>
      <button class="exclude-btn" data-act="exclude" data-k="${o.k}" aria-label="${excluded ? '恢复' : '排除'}选项 ${o.k}" aria-pressed="${excluded}" title="${excluded ? '恢复选项' : '划线排除（Shift+' + o.k + '）'}">${excluded ? '恢复' : '排除'}</button></div>`;
  }).join('');

  const multiHint = isMulti && pick
    ? `<div class="small muted" data-multi-hint style="margin-top:10px">已选 ${pick.split('').sort().join('')} —— 再点一次可取消该项</div>`
    : '';

  return `
  <div class="qmeta">
    <span class="chip acc">${esc(ref.type || '未分类')}</span>
    <span class="chip" title="${esc(ref.module || '')}">原卷第 ${ref.no} 题</span>
    ${isMulti ? '<span class="chip warn">多选</span>' : ''}
    ${q.judge ? '<span class="chip">判断</span>' : ''}
    <div class="right row"><button class="btn btn-sm ${a.flagged ? 'btn-primary' : ''}" data-act="flag" aria-pressed="${!!a.flagged}">${a.flagged ? '已标记' : '标记'}</button>${favoriteButton(q, ref)}</div>
  </div>
  <div class="stem" data-mark-zone="stem">${ExamFormat.stem(q.stem, q.type)}</div>
  <div class="opts">${optHtml}</div>
  ${reviewControls(S.session, ref, a, true)}
  ${multiHint}`;
}

async function viewQuiz() {
  const sess = S.session;
  if (!sess) return `${topbar('')}${emptyBox(ExamTools.icon('file'), '没有进行中的练习', '去「套卷刷题」或「随机刷题」开始一次吧')}`;
  if (sess.submitted) { go('#/report/' + sess.id); return ''; }

  const qs = await ensureQuestions(sess.refs);
  const i = Math.min(sess.index, sess.refs.length - 1);
  sess.index = i;
  const ref = sess.refs[i];
  const q = qs[i] || qs.find((x) => x && x.qid === ref.qid);
  const a = ansOf(sess, ref.qid);
  if (!q) return `${topbar('')}${emptyBox(ExamTools.icon('file'), '题目加载失败', 'qid ' + ref.qid)}`;

  const answeredN = sess.refs.filter((r) => (sess.answers[r.qid]?.pick || '')).length;
  const flaggedN = sess.refs.filter((r) => sess.answers[r.qid]?.flagged).length;
  const elapsed = liveTime().total;

  const sheet = sess.refs.map((r, idx) => {
    const aa = sess.answers[r.qid] || {};
    let cls = aa.pick ? 'done' : '';
    if (idx === i) cls += ' cur';
    if (aa.flagged) cls += ' flagged';
    return `<button class="${cls}" data-act="jump" data-i="${idx}" ${idx === i ? 'aria-current="step"' : ''} aria-label="练习第 ${idx + 1} 题，${aa.pick ? '已答' : '未答'}${aa.flagged ? '，待复查' : ''}" title="${r.type} · 原卷第 ${r.no} 题${aa.flagged ? '（已标记）' : ''}">${idx + 1}</button>`;
  }).join('');

  const body = q.material
    ? `<div class="qbody with-mat">
        <div class="mat"><div class="mat-h">材料${q.materialNo ? ' ' + q.materialNo : ''}</div><div data-mark-zone="material">${q.material}</div></div>
        <div class="qmain">${renderQuestion(q, ref, a)}</div>
      </div>`
    : `<div class="qbody">${renderQuestion(q, ref, a)}</div>`;

  const pctDone = Math.round((answeredN / sess.refs.length) * 100);

  return `<div class="exam-view ${sess.paused ? 'is-paused' : ''}" style="--paper-size:${Math.min(24, Math.max(16, SETTINGS.paperSize || 19))}px">${topbar('')}
  <div class="quizbar">
    <button class="btn btn-sm btn-ghost" data-act="exit-quiz">← 退出</button>
    <div class="ttl" title="${esc(sess.title)}">${esc(displayTitle(sess.title))}</div>
    <div class="right row">
      <span class="prog">已答 <b>${answeredN}</b>/${sess.refs.length}</span>
      <span class="clock" role="timer" aria-label="练习总用时">总计 <b data-clock="total">${fmtClock(elapsed)}</b></span>
      <span class="clock" role="timer" aria-label="当前题用时">本题 <b data-clock="current">${fmtClock(a.ms || 0)}</b></span>
      <button class="btn btn-sm" data-act="pause-quiz">${sess.paused ? '继续计时' : '暂停'}</button>
      <button class="btn btn-sm btn-primary" data-act="submit-quiz">交卷</button>
    </div>
  </div>
  <div class="progress" style="margin:-8px 0 14px"><i style="width:${pctDone}%"></i></div>

  <div class="quiz-wrap">
    <div class="card exam-paper">
      <div class="paper-head"><span>第 ${i + 1} 题</span><span>共 ${sess.refs.length} 题</span></div>
      ${ExamTools.toolbar()}
      <div class="paper-content">
      ${body}
      </div>
      ${sess.paused ? '<div class="pause-cover"><b>练习已暂停</b><p>计时已停止，继续后显示题目。</p><button class="btn btn-primary" data-act="pause-quiz">继续作答</button></div>' : ''}
      <div class="qnav">
        <button class="btn" data-act="prev" ${i === 0 ? 'disabled' : ''}>← 上一题</button>
        <button class="btn" data-act="next" ${i === sess.refs.length - 1 ? 'disabled' : ''}>下一题 →</button>
        <div class="r">
          <button class="btn btn-sm btn-ghost" data-act="clear-pick" ${a.pick ? '' : 'disabled'}>清除答案</button>
        </div>
      </div>
    </div>

    <div class="aside">
      <details class="card card-pad sheet-panel" open>
        <summary>答题卡 <span>${answeredN} / ${sess.refs.length}</span></summary>
        <div class="tiny muted" style="margin-bottom:12px" data-sheet-count>${flaggedN ? `标记待复查 ${flaggedN} 题` : ''}</div>
        <div class="sheet">${sheet}</div>
        <div class="legend">
          <span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>已答</span>
          <span><i style="background:var(--panel);border:1px solid var(--border-strong)"></i>未答</span>
          <span><i style="background:var(--warn)"></i>标记</span>
        </div>
        <div class="review-jumps"><button class="btn btn-sm" data-act="jump-unanswered">下一道未答</button><button class="btn btn-sm" data-act="jump-flagged">下一道标记</button></div>
        <details class="quiz-preferences"><summary>练习设置</summary><label class="auto-pause"><input type="checkbox" data-act="auto-pause" ${SETTINGS.autoPause ? 'checked' : ''}>切换标签自动暂停</label><p>A–D 选择 · Shift+A–D 排除<br>方向键切题 · F 标记</p></details>
      </details>
      <div class="card card-pad scratch-card"><label for="question-note">草稿</label><textarea id="question-note" data-act="question-note" placeholder="写下你的思路…">${esc(a.note || '')}</textarea></div>
    </div>
  </div></div>`;
}

/* ---------------------------------------------------------- 视图：报告 */

async function viewReport(sid, opts = {}) {
  let sess = getSessions().find((s) => s.id === sid);
  if (!sess && S.session && S.session.id === sid) sess = S.session;
  if (!sess) return `${topbar('')}${emptyBox(ExamTools.icon('file'), '找不到这次记录', '可能已被删除')}`;

  const qs = await ensureQuestions(sess.refs);
  const sum = summarize(sess, qs);
  ExamTools.reviewSession = sess;
  const scope = V.reportScope || 'all';
  const rows = exportRows(sess, qs, scope);

  const typeTable = `<table class="tbl performance-table">
    <thead><tr><th>题型</th><th class="num">正确 / 已答</th><th class="num">未答</th><th class="num">正确率</th><th class="num">平均用时</th></tr></thead>
    <tbody>${sum.byType.map((t) => `<tr>
      <td title="${esc(moduleOfType(t.type))}">${esc(t.type)}</td>
      <td class="num">${t.ok} / ${t.ans}</td><td class="num">${t.n - t.ans}</td>
      <td class="num" style="color:${t.ans && t.ok / t.ans < .7 ? 'var(--bad)' : 'var(--text)'}">${pct(t.ok, t.ans)}</td>
      <td class="num muted">${avgSec(t.ms, t.ans)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>合计</td><td class="num">${sum.right} / ${sum.answered}</td>
      <td class="num">${sum.unanswered}</td><td class="num">${pct(sum.right, sum.answered)}</td>
      <td class="num">${avgSec(sum.totalMs, sum.answered)}</td></tr></tfoot>
  </table>`;

  const rowHtml = (r) => {
    const q = r.q;
    const a = r.a;
    const stateChip = !a.pick ? '<span class="chip">未答</span>' : r.correct ? '<span class="chip ok">正确</span>' : '<span class="chip bad">错误</span>';
    return `<details class="qitem review-item">
      <summary class="review-summary">
        <span class="review-heading">
          <span class="review-identity"><b class="review-number" title="原卷题号">第 ${r.ref.no} 题</b><span class="review-time">用时 <b>${fmtDur(a.ms)}</b></span></span>
          <span class="review-result">${stateChip}</span>
          <span class="review-toggle"><span class="when-closed">展开</span><span class="when-open">收起</span></span>
        </span>
        <span class="qt">${q ? esc(questionExcerpt(q)) : '（题目未加载）'}</span>
      </summary>
      <div class="detail" data-review-qid="${esc(r.ref.qid)}">
        <div class="row tiny muted" style="margin-bottom:10px">
          <span class="chip acc">${esc(r.ref.type || '未分类')}</span>
          <div class="right">${favoriteButton(q, r.ref)}</div>
        </div>
        ${q && q.material ? `<div class="mat" style="margin-bottom:12px"><div class="mat-h">材料</div><div data-mark-zone="material">${q.material}</div></div>` : ''}
        <div class="stem" data-mark-zone="stem">${q ? ExamFormat.stem(q.stem, q.type) : ''}</div>
        <div class="opts">${q ? q.options.map((o) => {
          const isAns = q.answer.includes(o.k);
          const isMine = (a.pick || '').includes(o.k);
          const cls = isAns ? 'locked correct' : isMine ? 'locked wrong' : 'locked';
          return `<div class="opt ${cls}"><div class="k">${o.k}</div><div class="t" data-mark-zone="opt-${o.k}">${o.t}</div>${(a.excluded || '').includes(o.k) ? '<span class="tiny muted">曾排除</span>' : ''}</div>`;
        }).join('') : ''}</div>
        <div class="verdict ${r.correct ? 'ok' : 'bad'}" style="margin-top:12px">
          我的答案：<b>${a.pick || '未作答'}</b>　正确答案：<b>${q ? q.answer : '?'}</b>　用时：<b>${fmtSec(a.ms)}</b>
        </div>
        ${a.note ? `<div class="review-note"><b>我的草稿 / 思路</b><p>${esc(a.note)}</p></div>` : ''}
        ${reviewControls(sess, r.ref, a)}
        ${q && q.explanation ? `<details class="expl-toggle" ${V.showAllExpl ? 'open' : ''}><summary>查看官方解析</summary>
          <div class="expl">${q.explanation}</div></details>` : ''}
      </div>
    </details>`;
  };

  /** 按题型分组，便于复盘；含错题的组默认展开 */
  const groupHtml = () => {
    const groups = new Map();
    for (const r of rows) {
      const t = r.ref.type || '未分类';
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(r);
    }
    const order = CAT.typeOrder.filter((t) => groups.has(t)).concat([...groups.keys()].filter((t) => !CAT.typeOrder.includes(t)));
    return order.map((t) => {
      const rs = groups.get(t);
      const ok = rs.filter((r) => r.correct).length;
      const bad = rs.filter((r) => r.answered && !r.correct).length;
      const un = rs.filter((r) => !r.answered).length;
      const open = order.length === 1 || bad + un > 0 && rs.length <= 40;
      return `<details class="qgroup" ${open ? 'open' : ''}>
        <summary>
          <span class="gtype">${esc(t)}</span>
          <span class="tiny muted">${esc(moduleOfType(t))}</span>
          <span class="spacer"></span>
          <span class="tiny"><b>${rs.length}</b> 题</span>
          ${ok ? `<span class="chip ok tiny">正确 ${ok}</span>` : ''}
          ${bad ? `<span class="chip bad tiny">错误 ${bad}</span>` : ''}
          ${un ? `<span class="chip tiny">未答 ${un}</span>` : ''}
        </summary>
        ${rs.map(rowHtml).join('')}
      </details>`;
    }).join('');
  };

  return `${topbar('history')}
  <header class="report-heading"><div><a class="back-link" href="#/history">练习记录</a><h1 title="${esc(sess.title)}">${esc(displayTitle(sess.title))}</h1><p>${fmtTime(sess.submittedAt || sess.createdAt)} · ${sum.total} 题</p></div>
    <details class="action-menu"><summary class="btn">导出与管理</summary><div class="menu-body">
      <button class="btn btn-ghost" data-act="download-zip" data-id="${sess.id}">Markdown + 图片（ZIP）</button>
      <button class="btn btn-ghost" data-act="download-pdf" data-id="${sess.id}">下载复盘 PDF</button>
      <button class="btn btn-ghost" data-act="print-export" data-id="${sess.id}">打印复盘报告</button>
      <button class="btn btn-ghost" data-act="print-questions" data-source="report" data-id="${sess.id}">打印空白试题</button>
      <button class="btn btn-ghost" data-act="download-questions" data-source="report" data-id="${sess.id}">导出空白打印版</button>
      <button class="btn btn-ghost" data-act="download-question-pdf" data-source="report" data-id="${sess.id}">下载空白试题 PDF</button>
      <button class="btn btn-ghost" data-act="download-html" data-id="${sess.id}">带图网页（单文件）</button>
      <button class="btn btn-ghost" data-act="export-md" data-id="${sess.id}">复制 Markdown 文字</button>
      <button class="btn btn-ghost" data-act="download-md" data-id="${sess.id}">仅下载 Markdown</button>
      <button class="btn btn-ghost" data-act="download-json" data-id="${sess.id}">下载 JSON</button>
      <button class="btn btn-ghost" data-act="preview-export" data-id="${sess.id}">预览导出文字</button>
      <p class="export-help">导出当前筛选的题目、自评和复盘描述。上传图形题给 AI，建议使用带图 PDF。</p>
      <label class="menu-check"><input type="checkbox" data-act="set" data-k="exportExpl" ${SETTINGS.exportExpl ? 'checked' : ''}>包含解析</label>
      <label class="menu-check"><input type="checkbox" data-act="set" data-k="exportMat" ${SETTINGS.exportMat ? 'checked' : ''}>包含材料</label>
      <button class="btn btn-ghost btn-danger" data-act="del-session" data-id="${sess.id}">删除记录</button></div></details>
  </header>
  <section class="result-overview">
    <div class="result-accuracy"><span>正确率</span><div><b>${sum.answered ? Math.round(sum.right / sum.answered * 100) : '—'}</b>${sum.answered ? '<span>%</span>' : ''}</div></div>
    <div class="result-breakdown"><div class="result-counts"><div><b>${sum.right}</b><span>正确</span></div><div class="error-count"><b>${sum.wrong}</b><span>错误</span></div><div><b>${sum.unanswered}</b><span>未答</span></div></div>
      <div class="result-bar" aria-label="正确 ${sum.right}，错误 ${sum.wrong}，未答 ${sum.unanswered}"><i class="right-part" style="width:${sum.right / (sum.total || 1) * 100}%"></i><i class="wrong-part" style="width:${sum.wrong / (sum.total || 1) * 100}%"></i></div>
    </div>
    <div class="result-time"><div><span>总用时</span><b>${fmtDur(sum.totalMs)}</b></div><div><span>平均每题</span><b>${avgSec(sum.totalMs, sum.answered)}</b></div></div>
  </section>

  <div class="card">
    <div class="card-head"><h3>分题型表现</h3><div class="spacer"></div>
      </div>
    ${typeTable}
  </div>

  <div class="card">
    <div class="card-head">
      <h3>题目明细</h3>
      <div class="seg row" style="margin-left:8px">
        ${[['all', '全部'], ['consolidate', '需巩固'], ['wrong+unanswered', '错题+未答'], ['wrong', '仅错题'], ['unanswered', '未作答']].map(([v, l]) =>
          `<button class="btn btn-sm ${scope === v ? 'btn-primary' : ''}" data-act="rscope" data-v="${v}">${l}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <label class="check ${V.showAllExpl ? 'on' : ''}"><input type="checkbox" data-act="showall-expl" ${V.showAllExpl ? 'checked' : ''}>展开全部解析</label>
      <span class="small muted">${rows.length} 题</span>
    </div>
    ${rows.length ? groupHtml() : emptyBox(ExamTools.icon('file'), '这里没有题目', '换个筛选条件看看')}
  </div>`;
}

/* ---------------------------------------------------------- 视图：记录 */

function viewHistory() {
  const sessions = getSessions();
  if (!sessions.length) return `${topbar('history')}<div class="card card-pad row"><h1 style="font-size:19px">记录与导出</h1><div class="right row"><button class="btn btn-sm" data-act="backup">导出完整备份</button><button class="btn btn-sm" data-act="restore">导入完整备份</button></div></div>${emptyBox(ExamTools.icon('file'), '还没有做题记录', '完成一次练习后会出现在这里；未完成练习也可备份')}`;

  const agg = new Map();
  for (const s of sessions) for (const t of s.meta?.byType || []) {
    if (!agg.has(t.type)) agg.set(t.type, { type: t.type, n: 0, ans: 0, ok: 0, ms: 0 });
    const b = agg.get(t.type);
    b.n += t.n; b.ans += t.ans; b.ok += t.ok; b.ms += t.ms;
  }
  const weak = [...agg.values()].filter((t) => t.ans >= 3).sort((a, b) => a.ok / a.ans - b.ok / b.ans).slice(0, 5);

  const totalQ = sessions.reduce((s, x) => s + (x.meta?.total || 0), 0);
  const totalOk = sessions.reduce((s, x) => s + (x.meta?.right || 0), 0);
  const totalAns = sessions.reduce((s, x) => s + (x.meta?.answered || 0), 0);

  const sel = V.historySel;
  return `${topbar('history')}
  <div class="card card-pad">
    <div class="row"><h1 style="font-size:19px">记录与导出</h1><div class="spacer"></div>
      <button class="btn btn-sm" data-act="backup">导出完整备份</button>
      <button class="btn btn-sm" data-act="restore">导入完整备份</button>
    </div>
    <div class="score" style="margin-top:18px">
      <div class="s"><b>${sessions.length}</b><span>次练习</span></div>
      <div class="s"><b>${totalQ}</b><span>累计题量</span></div>
      <div class="s ok"><b>${totalOk}</b><span>累计正确</span></div>
      <div class="s ${totalAns && totalOk / totalAns >= 0.7 ? 'ok' : 'bad'}"><b>${pct(totalOk, totalAns)}</b><span>总正确率</span></div>
    </div>
  </div>

  ${weak.length ? `<div class="card">
    <div class="card-head"><h3>薄弱题型（按历史正确率）</h3><div class="spacer"></div>
      <button class="btn btn-sm btn-primary" data-act="practice-weak">针对薄弱题型随机刷</button></div>
    <table class="tbl">
      <thead><tr><th>题型</th><th>所属模块</th><th class="num">作答</th><th class="num">正确</th><th class="num">正确率</th></tr></thead>
      <tbody>${weak.map((t) => `<tr><td>${esc(t.type)}</td><td class="dim small">${esc(moduleOfType(t.type))}</td>
        <td class="num">${t.ans}</td><td class="num">${t.ok}</td>
        <td class="num" style="color:${t.ok / t.ans >= 0.7 ? 'var(--ok)' : 'var(--bad)'}"><b>${pct(t.ok, t.ans)}</b></td></tr>`).join('')}</tbody>
    </table>
  </div>` : ''}

  <div class="card">
    <div class="card-head"><h3>历次练习</h3>
      <div class="spacer"></div>
      <span class="small muted">已选 ${sel.size} 次</span>
      <button class="btn btn-sm" data-act="sel-all">全选</button>
      <button class="btn btn-sm" data-act="sel-none">清空</button>
      <button class="btn btn-sm" data-act="sel-invert">反选</button>
      <button class="btn btn-sm btn-primary" data-act="export-multi" ${sel.size ? '' : 'disabled'}>导出所选</button>
    </div>
    <table class="tbl">
      <thead><tr>
        <th style="width:34px"></th><th>时间</th><th>名称</th><th>类型</th>
        <th class="num">题量</th><th class="num">作答</th><th class="num">正确</th><th class="num">正确率</th><th class="num">用时</th><th></th>
      </tr></thead>
      <tbody>${sessions.map((s) => {
        const m = s.meta || {};
        return `<tr>
          <td><input type="checkbox" data-act="hsel" data-id="${s.id}" ${sel.has(s.id) ? 'checked' : ''} style="accent-color:var(--accent)"></td>
          <td class="small nowrap muted">${fmtTime(s.submittedAt || s.createdAt)}</td>
          <td title="${esc(s.title)}">${esc(displayTitle(s.title))}</td>
          <td class="small dim nowrap">${s.kind === 'paper' ? '套卷' : s.kind === 'wrong' ? '错题重刷' : '随机'}</td>
          <td class="num">${m.total ?? s.refs.length}</td>
          <td class="num">${m.answered ?? '—'}</td>
          <td class="num" style="color:var(--ok)">${m.right ?? '—'}</td>
          <td class="num"><b>${pct(m.right, m.answered)}</b></td>
          <td class="num muted">${fmtDur(m.totalMs)}</td>
          <td class="num nowrap"><a href="#/report/${s.id}">查看</a></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <div class="card-pad row">
      <button class="btn btn-sm btn-ghost btn-danger" data-act="clear-sessions">清空全部记录</button>
      <span class="small muted">最多保留 ${MAX_SESSIONS} 次；导出后即可安全删除。</span>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- 视图：错题本 */

async function viewWrong() {
  const wb = getWrong();
  const entries = Object.entries(wb);
  if (!entries.length) return `${topbar('wrong')}${emptyBox(ExamTools.icon('file'), '错题本是空的', '做错的题会自动收集到这里')}`;

  entries.sort((a, b) => (b[1].n - a[1].n) || (b[1].last - a[1].last));
  const filtered = V.wrongFilter ? entries.filter(([, v]) => v.ref.type === V.wrongFilter) : entries;

  const types = [...new Set(entries.map(([, v]) => v.ref.type))];
  const countByType = {};
  for (const [, v] of entries) countByType[v.ref.type] = (countByType[v.ref.type] || 0) + 1;

  // 分批加载，避免一次插入过多 script
  const refs = filtered.map(([, v]) => v.ref);
  await ensureQuestions(refs);

  const list = filtered.map(([qid, v]) => {
    const q = QMAP.get(qid);
    if (!q) return '';
    return `<details class="qitem">
      <summary>
        <span class="chip bad">错 ${v.n} 次</span>
        <span class="chip tiny">${esc(v.ref.type)}</span>
        <span class="qt">${esc(questionExcerpt(q))}</span>
        <span class="tiny muted nowrap">最近 ${fmtTime(v.last).slice(5)}</span>
      </summary>
      <div class="detail">
        <div class="row" style="justify-content:flex-end;margin-bottom:14px">${favoriteButton(q, v.ref)}</div>
        ${q.material ? `<div class="mat" style="margin-bottom:12px"><div class="mat-h">材料</div>${q.material}</div>` : ''}
        <div class="stem" style="font-size:19px">${ExamFormat.stem(q.stem, q.type)}</div>
        <div class="opts">${q.options.map((o) => {
          const isAns = q.answer.includes(o.k);
          return `<div class="opt locked ${isAns ? 'correct' : ''}"><div class="k">${o.k}</div><div class="t">${o.t}</div></div>`;
        }).join('')}</div>
        <div class="verdict ok" style="margin-top:12px">正确答案：<b>${q.answer}</b></div>
        ${q.explanation ? `<details class="expl-toggle"><summary>查看官方解析</summary><div class="expl">${q.explanation}</div></details>` : ''}
      </div>
    </details>`;
  }).join('');

  return `${topbar('wrong')}
  <div class="card card-pad">
    <div class="row"><h1 style="font-size:19px">错题本</h1>
      <span class="chip bad">${entries.length} 题</span>
      <div class="spacer"></div>
      <button class="btn btn-sm" data-act="wrong-md">导出 Markdown + 图片</button>
      <button class="btn btn-sm btn-primary" data-act="retry-wrong" data-t="${esc(V.wrongFilter)}">重刷${V.wrongFilter ? esc(V.wrongFilter) : '全部错题'}</button>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-sm ${!V.wrongFilter ? 'btn-primary' : ''}" data-act="wfilter" data-t="">全部 ${entries.length}</button>
      ${types.map((t) => `<button class="btn btn-sm ${V.wrongFilter === t ? 'btn-primary' : ''}" data-act="wfilter" data-t="${esc(t)}">${esc(t)} ${countByType[t]}</button>`).join('')}
    </div>
  </div>
  <div class="card">${list || emptyBox('—', '没有匹配的错题', '')}</div>`;
}

/* ---------------------------------------------------------- 视图：弹层 */

function modal(title, bodyHtml, actions = '') {
  // 注意：不要在 .modal 上用 onclick="event.stopPropagation()"，
  // 那会挡住 document 上的事件委托，导致弹层里的按钮全部失效。
  // 点击遮罩关闭的逻辑由 data-act="close-modal-bg" 里判断 e.target === el 完成。
  return `<div class="modal-bg" data-act="close-modal-bg">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h3 id="modal-title">${esc(title)}</h3>
        <button class="btn btn-sm btn-ghost" data-act="close-modal">关闭</button></div>
      <div class="modal-body">${bodyHtml}</div>
      ${actions ? `<div class="modal-head" style="border-top:1px solid var(--border);border-bottom:none;justify-content:flex-end">${actions}</div>` : ''}
    </div>
  </div>`;
}

let MODAL = null;

async function viewFavorites() {
  const all = Object.values(getFavorites()).sort((a,b) => b.createdAt - a.createdAt);
  const filter = V.favoriteFilter || '';
  const items = all.filter(v => !filter || v.ref.type === filter);
  await ensureQuestions(items.map(v => v.ref));
  const types = [...new Set(all.map(v => v.ref.type))];
  return `${topbar('favorites')}<header class="page-heading"><h1>收藏题</h1><p>保存有价值的题目，集中重刷。相同题面、材料和选项只收藏一次。</p></header>
    <div class="card card-pad"><div class="row"><b>共 ${items.length} 题</b><div class="right"><button class="btn btn-primary" data-act="retry-favorites" ${!items.length ? 'disabled' : ''}>练习这些收藏题</button></div></div>
    <div class="favorite-filters row">${['',...types].map(t => `<button class="btn btn-sm ${filter === t ? 'btn-primary' : ''}" data-act="favorite-filter" data-type="${esc(t)}">${t || '全部'}</button>`).join('')}</div></div>
    <div class="card">${items.length ? items.map(v => {
      const q=QMAP.get(v.ref.qid); if(!q)return '';
      return `<details class="qitem"><summary><span class="chip">${esc(v.ref.type)}</span><span class="qt">${esc(questionExcerpt(q))}</span></summary><div class="detail"><div class="row"><span class="muted">原卷第 ${v.ref.no} 题</span><div class="right">${favoriteButton(q,v.ref)}</div></div>${q.material ? `<div class="mat">${q.material}</div>` : ''}<div class="stem">${ExamFormat.stem(q.stem,q.type)}</div><div class="opts">${q.options.map(o=>`<div class="opt locked"><div class="k">${o.k}</div><div class="t">${o.t}</div></div>`).join('')}</div><details class="expl-toggle"><summary>查看答案与解析</summary><b>答案：${q.answer}</b><div class="expl">${q.explanation || ''}</div></details></div></details>`;
    }).join('') : emptyBox('', '还没有收藏题', '答题或复盘时点击「收藏」，这里就能找到。')}</div>`;
}

/* ---------------------------------------------------------- 渲染 */

let rendering = false;
let pendingRender = false;
let lastViewKey = '';
async function render() {
  if (rendering) { pendingRender = true; return; }
  rendering = true;
  try {
    const prev = route;
    route = parseHash();
    if (prev.name === 'quiz' && route.name !== 'quiz') { flushTime(); S.shownAt = 0; saveActive(); }
    const oldViewKey = `${prev.name}:${prev.args.join('/')}:${S.session?.index ?? ''}`;
    const materialScroll = $('.mat')?.scrollTop || 0;
    // 从别处进入某卷详情时，勾选重置为「整卷」，免得上次的窄选择让人困惑
    if (route.name === 'paper' && route.args[0]) {
      const samePaper = prev.name === 'paper' && prev.args[0] === route.args[0];
      if (!samePaper) delete V.paperSel[route.args[0]];
    }
    let html = '';
    switch (route.name) {
      case 'home': html = viewHome(); break;
      case 'papers': html = viewPapers(); break;
      case 'paper': html = await viewPaper(route.args[0]); break;
      case 'custom': html = viewCustom(); break;
      case 'quiz': html = await viewQuiz(); break;
      case 'report': html = await viewReport(route.args[0]); break;
      case 'history': html = viewHistory(); break;
      case 'wrong': html = await viewWrong(); break;
      case 'favorites': html = await viewFavorites(); break;
      default: html = `${topbar('')}${emptyBox(ExamTools.icon('file'), '页面不存在', '')}`;
    }
    app.className = 'app' + (['quiz', 'report'].includes(route.name) ? ' wide' : '');
    app.innerHTML = html + (MODAL || '');
    MODAL = null;
    ExamTools.mount();
    syncClock();
    $('.modal [data-act="close-modal"]')?.focus();
    // 只有换了页面或换了题才回到顶部，避免看材料时被反复弹回
    const viewKey = `${route.name}:${route.args.join('/')}:${S.session?.index ?? ''}`;
    if (viewKey !== lastViewKey) { window.scrollTo({ top: 0 }); lastViewKey = viewKey; }
    if (viewKey === oldViewKey && $('.mat')) $('.mat').scrollTop = materialScroll;
  } catch (e) {
    console.error(e);
    app.innerHTML = `${topbar('')}${emptyBox(ExamTools.icon('file'), '出错了', esc(e.message))}`;
  } finally {
    rendering = false;
    if (pendingRender) { pendingRender = false; render(); }
  }
}

/* ---------------------------------------------------------- 动作 */

const ACT = {
  favorite(e, el) {
    const q = QMAP.get(el.dataset.qid); if(!q)return;
    const key = questionKey(q), favorites = getFavorites();
    const on = !favorites[key];
    if(on) favorites[key] = {createdAt:Date.now(),ref:makeRef(q,el.dataset.src,el.dataset.key)};
    else delete favorites[key];
    if(!store.set(K.favorites,favorites))return;
    for(const btn of document.querySelectorAll('[data-act="favorite"]')) {
      if(questionKey(QMAP.get(btn.dataset.qid) || q)!==key)continue;
      btn.textContent=on?'已收藏':'收藏';btn.classList.toggle('btn-primary',on);btn.setAttribute('aria-pressed',String(on));
    }
    if(route.name==='favorites')render();
  },
  'favorite-filter'(e,el) { V.favoriteFilter=el.dataset.type;render(); },
  async 'retry-favorites'() {
    const refs=Object.values(getFavorites()).filter(v=>!V.favoriteFilter || v.ref.type===V.favoriteFilter).map(v=>v.ref);
    if(!refs.length)return toast('没有收藏题');
    startSession({id:newId(),kind:'favorites',title:`收藏重刷 · ${V.favoriteFilter || '全部'} ${refs.length} 题`,paperId:null,
      createdAt:Date.now(),submittedAt:null,refs:shuffle(refs,Date.now() & 0x7fffffff),answers:{},index:0,submitted:false});
  },
  'review-label'(e,el) {
    const {sid,qid,field,value}=el.dataset;
    const allowed=field==='familiarity'?FAMILIARITY:field==='confidence'?CONFIDENCE:null;
    if(!allowed?.[value])return;
    const list=getSessions();
    const active=S.session?.id===sid && !S.session.submitted;
    const sess=active ? S.session : list.find(s=>s.id===sid);
    if(!sess || !sess.refs.some(r=>r.qid===qid))return;
    const a=ansOf(sess,qid);a.review={...a.review};
    if(a.review[field]===value)delete a.review[field];else a.review[field]=value;
    a.review.updatedAt=Date.now();
    if(active)saveActive();else if(!setSessions(list))return;
    if(ExamTools.reviewSession?.id===sid)ExamTools.reviewSession=sess;
    for(const btn of el.closest('[data-assessment]').querySelectorAll('[data-field="'+field+'"]')){
      const on=a.review[field]===btn.dataset.value;btn.classList.toggle('btn-primary',on);btn.setAttribute('aria-pressed',String(on));
    }
    const status=el.closest('[data-assessment]').querySelector('.assessment-status');
    if(status)status.textContent=assessment(a,!!a.pick && a.pick===QMAP.get(qid)?.answer).interpretation;
  },
  /* 首页 */
  resume() {
    S.session = store.get(K.active, null);
    if (!S.session) return toast('没有可继续的练习');
    S.shownAt = 0;
    go('#/quiz');
  },
  'discard-active'() {
    store.del(K.active);
    S.session = null;
    render();
  },

  /* 套卷列表 */
  pf(e, el) {
    V.paperFilter[el.dataset.k] = el.dataset.v;
    render();
  },
  'pf-sel'(e, el) {
    V.paperFilter[el.dataset.k] = el.value;
    render();
  },
  'open-paper'(e, el) { go('#/paper/' + el.dataset.id); },
  async 'quiz-random-paper'() {
    const p = CAT.papers[Math.floor(Math.random() * CAT.papers.length)];
    go('#/paper/' + p.id);
  },

  /* 卷详情页：勾选要做哪些题型 / 模块 */
  'psel-type'(e, el) {
    const sel = V.paperSel[el.dataset.id];
    if (!sel) return;
    const t = el.dataset.t;
    if (sel.has(t)) sel.delete(t); else sel.add(t);
    render();
  },
  'psel-module'(e, el) {
    const sel = V.paperSel[el.dataset.id];
    const meta = paperById.get(el.dataset.id);
    if (!sel || !meta) return;
    const types = CAT.typeOrder.filter((t) => meta.types[t] && moduleOfType(t) === el.dataset.m);
    const allOn = types.every((t) => sel.has(t));
    types.forEach((t) => (allOn ? sel.delete(t) : sel.add(t)));
    render();
  },
  'psel-module-only'(e, el) {
    const meta = paperById.get(el.dataset.id);
    if (!meta) return;
    const keep = CAT.typeOrder.filter((t) => meta.types[t] && moduleOfType(t) === el.dataset.m);
    V.paperSel[el.dataset.id] = new Set(keep);
    render();
  },
  'psel-all'(e, el) {
    const meta = paperById.get(el.dataset.id);
    if (meta) V.paperSel[el.dataset.id] = new Set(Object.keys(meta.types));
    render();
  },
  'psel-none'(e, el) { V.paperSel[el.dataset.id] = new Set(); render(); },

  /** 从列表页直接只做某个模块 */
  async 'start-paper-module'(e, el) {
    const pid = el.dataset.id;
    const meta = paperById.get(pid);
    if (!meta) return;
    const types = CAT.typeOrder.filter((t) => meta.types[t] && moduleOfType(t) === el.dataset.m);
    V.paperSel[pid] = new Set(types);
    await ACT['start-paper-part'](e, { dataset: { id: pid } });
  },

  /** 按当前勾选开始一套卷（可只做部分题型） */
  async 'start-paper-part'(e, el) {
    const pid = el.dataset.id;
    const pf = await loadPaper(pid);
    for (const q of pf.questions) QMAP.set(q.qid, q);
    const sel = V.paperSel[pid] || new Set(Object.keys(pf.types));
    const refs = pf.questions.filter((q) => sel.has(q.type)).map((q) => makeRef(q, 'p', pf.id));
    if (!refs.length) return toast('请先勾选要做的题型');

    const mods = [...new Set(refs.map((r) => r.module))];
    const parts = [];
    for (const m of CAT.modules) {
      const n = refs.filter((r) => r.module === m).length;
      if (n) parts.push(`${m} ${n} 题`);
    }
    const onlyOneModule = mods.length === 1;
    const title = onlyOneModule
      ? `${pf.name} · 仅${parts[0]}`
      : `${pf.name} · ${refs.length} 题（${parts.map((p) => p.split(' ')[0]).join('+')}）`;

    startSession({
      id: newId(), kind: 'paper', title, paperId: pf.id,
      createdAt: Date.now(), submittedAt: null,
      refs, answers: {}, index: 0, submitted: false,
    });
  },

  /* 随机刷题设置 */
  ct(e, el) {
    const t = el.dataset.t;
    if (V.custom.types.has(t)) V.custom.types.delete(t); else V.custom.types.add(t);
    render();
  },
  'ct-all'() { CAT.typeOrder.forEach((t) => V.custom.types.add(t)); render(); },
  'ct-none'() { V.custom.types.clear(); render(); },
  'ct-module'(e, el) {
    V.custom.types.clear();
    CAT.typeOrder.filter((t) => moduleOfType(t) === el.dataset.m).forEach((t) => V.custom.types.add(t));
    render();
  },
  ctotal(e, el) { V.custom.total = Math.max(1, +el.value || 1); render(); },
  'ctotal-set'(e, el) { V.custom.total = +el.dataset.n; render(); },
  cy(e, el) {
    const y = el.dataset.y;
    if (V.custom.years.has(y)) V.custom.years.delete(y); else V.custom.years.add(y);
    render();
  },
  async 'start-custom'() {    const types = CAT.typeOrder.filter((t) => V.custom.types.has(t));
    if (!types.length) return toast('请先选择题型');
    toast('正在抽取题目…');
    const pools = await loadPools(types);
    const years = V.custom.years;
    const avail = {};
    const filtered = {};
    for (const p of pools) {
      const keep = p.questions.filter((q) => {
        const sourceYears = q.sourceYears || [yearOfPid(q.pid)];
        return !years.size || sourceYears.some(y => y != null && years.has(String(y)));
      });
      filtered[p.type] = keep;
      avail[p.type] = keep.length;
      for (const q of keep) QMAP.set(q.qid, q);
      loadedKeys.add('q:' + POOL_INDEX[p.type].key);
    }
    const total = Math.min(V.custom.total, Object.values(avail).reduce((a, b) => a + b, 0));
    if (!total) return toast('所选年份范围内没有题目');
    const alloc = allocate(types, avail, total);
    const seed = (Date.now() & 0x7fffffff) || 1;
    const refs = [];
    types.forEach((t, i) => {
      const n = alloc[i];
      if (!n) return;
      const picked = shuffle(filtered[t], seed + i * 7919).slice(0, n);
      const key = POOL_INDEX[t].key;
      for (const q of picked) refs.push(makeRef(q, 'q', key));
    });
    // 打散，避免同题型连在一起
    const finalRefs = shuffle(refs, seed ^ 0x5bf03635);
    const title = `${types.length === 1 ? types[0] : types.length + ' 类题型'} · 随机 ${finalRefs.length} 题`;
    startSession({
      id: newId(), kind: 'custom', title, paperId: null,
      createdAt: Date.now(), submittedAt: null,
      refs: finalRefs, answers: {}, index: 0, submitted: false,
    });
  },

  /* 答题：全程不提示对错，交卷后统一复盘 */
  pick(e, el) {
    const sess = S.session; if (!sess || sess.paused || sess.submitted) return;
    const ref = sess.refs[sess.index];
    const q = QMAP.get(ref.qid); if (!q) return;
    const a = ansOf(sess, ref.qid);
    const k = el.dataset.k;
    a.excluded = (a.excluded || '').replace(k, '');
    if (q.multi) {
      a.pick = a.pick.includes(k)
        ? a.pick.split('').filter((c) => c !== k).sort().join('')
        : (a.pick + k).split('').sort().join('');
    } else {
      a.pick = a.pick === k ? '' : k; // 再点一次可取消，方便改答案
    }
    saveActive();
    updateAnswerUI();
  },
  exclude(e, el) {
    const sess = S.session; if (!sess || sess.paused || sess.submitted) return;
    const a = ansOf(sess, sess.refs[sess.index].qid);
    const k = el.dataset.k;
    const excluded = (a.excluded || '').includes(k);
    a.excluded = excluded ? a.excluded.replace(k, '') : ((a.excluded || '') + k).split('').sort().join('');
    if (!excluded) a.pick = a.pick.replace(k, '');
    saveActive(); updateAnswerUI();
  },
  'clear-pick'() {
    const sess = S.session; if (!sess || sess.paused) return;
    ansOf(sess, sess.refs[sess.index].qid).pick = '';
    saveActive(); updateAnswerUI();
  },
  'pause-quiz'() {
    const sess = S.session; if (!sess) return;
    flushTime(); S.shownAt = 0;
    sess.paused = !sess.paused; saveActive(); render();
  },
  'jump-unanswered'() { jumpMatching((a) => !a.pick, '已经全部作答'); },
  'jump-flagged'() { jumpMatching((a) => a.flagged, '没有待复查的标记题'); },
  'auto-pause'(e, el) { SETTINGS.autoPause = el.checked; saveSettings(); syncClock(); },
  'replace-session'() {
    const sess = S.pendingSession; S.pendingSession = null; S.session = null;
    MODAL = null; if (sess) startSession(sess);
  },
  flag() {
    const sess = S.session; if (!sess || sess.paused) return;
    const ref = sess.refs[sess.index];
    const a = ansOf(sess, ref.qid);
    a.flagged = !a.flagged;
    saveActive();
    updateAnswerUI();
  },
  prev() { nav(-1); },
  next() { nav(1); },
  jump(e, el) { nav(0, +el.dataset.i); },

  'exit-quiz'() {
    flushTime(); saveActive();
    go('#/');
    toast('已保存进度，可在首页继续');
  },

  'submit-quiz'() {
    const sess = S.session; if (!sess) return;
    flushTime();
    const unanswered = sess.refs.filter((r) => !(sess.answers[r.qid]?.pick)).length;
    MODAL = modal('确认交卷',
      `<p>共 ${sess.refs.length} 题，已作答 <b>${sess.refs.length - unanswered}</b> 题${unanswered ? `，还有 <b style="color:var(--warn)">${unanswered}</b> 题未作答` : ''}。</p>
       <p class="small muted">交卷后将生成本次成绩报告，答案与官方解析会在报告里统一显示，错题自动收进错题本。</p>`,
      `<button class="btn btn-ghost" data-act="close-modal">再检查一下</button>
       <button class="btn btn-primary" data-act="do-submit">确认交卷</button>`);
    render();
  },

  async 'do-submit'() {
    MODAL = null;
    const sess = S.session; if (!sess || sess.submitted) return;
    if (getSessions().some(s => s.id === sess.id)) { S.session = null; S.shownAt = 0; go('#/report/' + sess.id); return; }
    flushTime();
    sess.submitted = true;
    sess.submittedAt = Date.now();
    const qs = await ensureQuestions(sess.refs);
    const { rows, ...summary } = summarize(sess, qs);
    sess.meta = summary;

    // 收集错题
    const wb = getWrong();
    const qByQid = new Map(qs.map((q) => [q.qid, q]));
    for (const r of sess.refs) {
      const a = sess.answers[r.qid];
      if (a?.pick && qByQid.has(r.qid) && a.pick !== qByQid.get(r.qid).answer) {
        const e = wb[r.qid] || { n: 0, last: 0, ref: r };
        e.n++; e.last = Date.now(); e.ref = r;
        wb[r.qid] = e;
      }
    }
    const list = getSessions();
    list.unshift(JSON.parse(JSON.stringify({ ...sess, refs: sess.refs, answers: sess.answers })));
    if (!setSessions(list)) {
      sess.submitted = false;
      saveActive();
      toast('成绩保存失败，当前练习已保留；请先导出备份或清理旧记录', 5000);
      render(); return;
    }
    setWrong(wb);
    store.del(K.active);
    S.session = null;
    go('#/report/' + sess.id);
  },

  /* 报告 */
  async 'print-questions'(e, el) {
    const preview = window.open('', '_blank');
    if (preview) { preview.document.title = '正在生成试题'; preview.document.body.textContent = '正在准备试题和图片…'; }
    try { await exportQuestions(el.dataset.source, el.dataset.id, preview); }
    catch (error) { if (preview && !preview.closed) preview.close(); throw error; }
  },
  async 'download-questions'(e, el) { await exportQuestions(el.dataset.source, el.dataset.id); },
  async 'download-question-pdf'(e, el) { await pdfAction(el,()=>exportQuestions(el.dataset.source, el.dataset.id, null, 'pdf')); },
  rscope(e, el) { V.reportScope = el.dataset.v; SETTINGS.exportScope = el.dataset.v; saveSettings(); render(); },
  'showall-expl'(e, el) { V.showAllExpl = el.checked; render(); },
  set(e, el) { SETTINGS[el.dataset.k] = el.checked; saveSettings(); el.closest('label')?.classList.toggle('on', el.checked); },

  async 'export-md'(e, el) { await doExport([el.dataset.id], 'md', 'copy'); },
  async 'download-md'(e, el) { await doExport([el.dataset.id], 'md', 'download'); },
  async 'download-zip'(e,el) { await doExport([el.dataset.id],'zip','download'); },
  async 'download-html'(e,el) { await doExport([el.dataset.id],'html','download'); },
  async 'download-pdf'(e,el) { await pdfAction(el,()=>doExport([el.dataset.id],'pdf','download')); },
  async 'print-export'(e,el) {
    const preview=window.open('','_blank');
    if(preview) {preview.document.title='正在生成带图报告';preview.document.body.textContent='正在生成带图报告…';}
    try {await doExport([el.dataset.id],'print',preview);}
    catch(error) {if(preview)preview.close();throw error;}
  },
  async 'download-json'(e, el) { await doExport([el.dataset.id], 'json', 'download'); },
  async 'preview-export'(e, el) {
    const [sess] = await prepareForExport(await pickSessions([el.dataset.id]));
    const md = buildMarkdown([sess], { expl: SETTINGS.exportExpl, material: SETTINGS.exportMat, scope: V.reportScope || 'all' });
    MODAL = modal('导出预览（Markdown）',
      `<div class="small muted" style="margin-bottom:10px">共 ${md.length.toLocaleString()} 字符。此处为文字预览；图片需使用带图导出。</div>
       <textarea readonly>${esc(md)}</textarea>`,
      `<button class="btn" data-act="copy-modal">复制</button>`);
    render();
  },
  async 'copy-modal'() {
    const ta = $('.modal textarea');
    if (ta && await copyText(ta.value)) toast('已复制到剪贴板');
  },

  'del-session'(e, el) {
    const list = getSessions().filter((s) => s.id !== el.dataset.id);
    setSessions(list);
    toast('已删除');
    go('#/history');
  },

  /* 记录 */
  hsel(e, el) {
    const id = el.dataset.id;
    if (V.historySel.has(id)) V.historySel.delete(id); else V.historySel.add(id);
    render();
  },
  'sel-all'() { getSessions().forEach((s) => V.historySel.add(s.id)); render(); },
  'sel-none'() { V.historySel.clear(); render(); },
  'sel-invert'() {
    const all = getSessions().map((s) => s.id);
    const next = new Set(all.filter((id) => !V.historySel.has(id)));
    V.historySel = next;
    render();
  },
  async 'export-multi'() { await doExport([...V.historySel], 'zip', 'download'); },
  'clear-sessions'() {
    MODAL = modal('清空全部记录', '<p>将删除所有练习记录（错题本不受影响）。此操作不可撤销，建议先导出备份。</p>',
      `<button class="btn btn-ghost" data-act="close-modal">取消</button>
       <button class="btn btn-primary" data-act="do-clear">确认清空</button>`);
    render();
  },
  'do-clear'() { MODAL = null; setSessions([]); V.historySel.clear(); toast('已清空'); render(); },

  backup() {
    saveActive();
    const blob = { settings: SETTINGS, active: S.session, sessions: getSessions(), wrong: getWrong(), favorites:getFavorites(), exportedAt: Date.now() };
    download(`行测刷题备份_${safeName(fmtTime(Date.now()))}.json`, JSON.stringify(blob, null, 2), 'application/json');
    toast('已导出备份文件');
  },
  restore() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(fr.result);
          if (!d || typeof d !== 'object' || !Array.isArray(d.sessions) || !d.sessions.every(validSession) || (d.active && !validSession(d.active)) || (d.wrong && (typeof d.wrong !== 'object' || Array.isArray(d.wrong)))) throw new Error('请使用「导出完整备份」生成的 JSON');
          if (d.favorites && (typeof d.favorites !== 'object' || Array.isArray(d.favorites) || !Object.values(d.favorites).every(v => v?.ref && typeof v.ref.qid === 'string' && ['p','q'].includes(v.ref.src) && typeof v.ref.key === 'string'))) throw new Error('收藏数据格式不正确');
          if (d.sessions) setSessions(d.sessions);
          if (d.favorites) store.set(K.favorites,d.favorites);
          if (d.wrong) setWrong(d.wrong);
          if (d.settings) { SETTINGS = { ...DEFAULT_SETTINGS, ...d.settings }; saveSettings(); }
          if (d.active) { S.session = { ...d.active, paused: true }; S.shownAt = 0; saveActive(); }
          toast('导入成功');
          render();
        } catch (err) { toast('导入失败：' + err.message, 4000); }
      };
      fr.readAsText(f);
    };
    inp.click();
  },

  'practice-weak'() {
    const sessions = getSessions();
    const agg = new Map();
    for (const s of sessions) for (const t of s.meta?.byType || []) {
      if (!agg.has(t.type)) agg.set(t.type, { n: 0, ans: 0, ok: 0 });
      const b = agg.get(t.type);
      b.n += t.n; b.ans += t.ans; b.ok += t.ok;
    }
    const weak = [...agg.entries()].filter(([, v]) => v.ans >= 3).sort((a, b) => a[1].ok / a[1].ans - b[1].ok / b[1].ans).slice(0, 4).map(([t]) => t);
    if (!weak.length) return toast('还没有足够的作答记录');
    V.custom.types = new Set(weak);
    V.custom.total = 30;
    go('#/custom');
    toast('已为你选好薄弱题型：' + weak.join('、'));
  },

  /* 错题本 */
  wfilter(e, el) { V.wrongFilter = el.dataset.t; render(); },
  async 'retry-wrong'(e, el) {
    const wb = getWrong();
    let items = Object.entries(wb);
    if (el.dataset.t) items = items.filter(([, v]) => v.ref.type === el.dataset.t);
    if (!items.length) return toast('没有错题');
    items = items.sort((a, b) => b[1].n - a[1].n).slice(0, 200);
    const refs = shuffle(items.map(([, v]) => v.ref), Date.now() & 0x7fffffff);
    startSession({
      id: newId(), kind: 'wrong',
      title: `错题重刷 · ${el.dataset.t || '全部'} ${refs.length} 题`,
      paperId: null, createdAt: Date.now(), submittedAt: null,
      refs, answers: {}, index: 0, submitted: false,
    });
  },
  async 'wrong-md'() {
    const wb = getWrong();
    const items = Object.entries(wb);
    if (!items.length) return toast('错题本是空的');
    await ensureQuestions(items.map(([, v]) => v.ref));
    const lines = ['# 错题本汇总', '', `> 导出时间：${fmtTime(Date.now())}　共 ${items.length} 道错题`, ''];
    const byType = new Map();
    for (const [qid, v] of items) {
      if (!byType.has(v.ref.type)) byType.set(v.ref.type, []);
      byType.get(v.ref.type).push([qid, v]);
    }
    for (const t of CAT.typeOrder.filter((x) => byType.has(x)).concat([...byType.keys()].filter((x) => !CAT.typeOrder.includes(x)))) {
      const arr = byType.get(t);
      lines.push(`## ${t}（${arr.length} 题，所属模块：${moduleOfType(t) || '—'}）`, '');
      arr.forEach(([qid, v], i) => {
        const q = QMAP.get(qid);
        if (!q) return;
        lines.push(`### ${i + 1}. 错 ${v.n} 次　\`qid ${qid}\``, '');
        if (SETTINGS.exportMat && q.material) { lines.push('**材料**', '', htmlToMd(q.material, '> '), ''); }
        lines.push('**题干**', '', htmlToMd(q.stem), '');
        lines.push('**选项**', '');
        for (const o of q.options) lines.push(`- ${o.k}. ${htmlToMd(o.t).replace(/\n+/g, ' ')}`);
        lines.push('', `**正确答案**：${q.answer}`, '');
        const latest = getSessions().find(s => s.answers[qid]?.pick)?.answers[qid];
        const review = assessment(latest || {}, !!latest?.pick && latest.pick === q.answer);
        lines.push(`**最近一次自评**：${review.familiarity}；${review.confidence}；${review.interpretation}`, '');
        lines.push(`**收藏**：${isFavorite(q) ? '是' : '否'}`, '');
        if (SETTINGS.exportExpl && q.explanation) lines.push('**官方解析**', '', htmlToMd(q.explanation, '> '), '');
        lines.push('---', '');
      });
    }
    const md = lines.join('\n');
    const images = await ExportTools.images(md, loadScript);
    const name = `错题本_${safeName(fmtTime(Date.now()))}`;
    download(name + '.zip', ExportTools.zip([{name:name+'.md',data:md},...Object.entries(images).map(([path,data])=>({name:path,data:ExportTools.decode(data)}))]), 'application/zip');
    toast('已下载错题本 Markdown 与图片，解压后打开',3500);
  },

  /* 弹层 */
  'close-modal'() { MODAL = null; render(); },
  'close-modal-bg'(e, el) { if (e.target === el) { MODAL = null; render(); } },
};

function nav(delta, abs) {
  const sess = S.session; if (!sess) return;
  flushTime();
  const n = sess.refs.length;
  sess.index = abs != null ? Math.max(0, Math.min(n - 1, abs)) : Math.max(0, Math.min(n - 1, sess.index + delta));
  S.shownAt = 0;
  saveActive();
  render();
}

function jumpMatching(test, message) {
  const sess = S.session; if (!sess || sess.paused) return;
  for (let step = 1; step <= sess.refs.length; step++) {
    const index = (sess.index + step) % sess.refs.length;
    if (test(sess.answers[sess.refs[index].qid] || {})) { nav(0, index); return; }
  }
  toast(message);
}

/** Answer operations do not replace the paper DOM, preserving selection, ink and scroll. */
function updateAnswerUI() {
  const sess = S.session; if (!sess || route.name !== 'quiz') return;
  const a = ansOf(sess, sess.refs[sess.index].qid);
  const answered = sess.refs.filter((r) => sess.answers[r.qid]?.pick).length;
  const flagged = sess.refs.filter((r) => sess.answers[r.qid]?.flagged).length;
  for (const opt of document.querySelectorAll('.exam-view .opt[data-k]')) {
    const k = opt.dataset.k;
    const selected = a.pick.includes(k);
    const excluded = (a.excluded || '').includes(k);
    opt.classList.toggle('sel', selected); opt.classList.toggle('excluded', excluded);
    opt.setAttribute('aria-checked', String(selected));
    opt.setAttribute('aria-label', `选项 ${k}${excluded ? '，已排除' : ''}`);
    const button = $('.exclude-btn', opt);
    button.textContent = excluded ? '恢复' : '排除';
    button.setAttribute('aria-label', `${excluded ? '恢复' : '排除'}选项 ${k}`);
    button.setAttribute('aria-pressed', String(excluded));
  }
  const flag = $('[data-act="flag"]');
  if (flag) {
    flag.classList.toggle('btn-primary', a.flagged);
    flag.setAttribute('aria-pressed', String(!!a.flagged));
    flag.textContent = a.flagged ? '已标记' : '标记';
  }
  const count = $('.quizbar .prog b'); if (count) count.textContent = answered;
  const progress = $('.progress i'); if (progress) progress.style.width = `${answered / sess.refs.length * 100}%`;
  const sheetCount = $('[data-sheet-count]'); if (sheetCount) sheetCount.textContent = flagged ? `标记待复查 ${flagged} 题` : '';
  const sheetSummary = $('.sheet-panel summary span'); if (sheetSummary) sheetSummary.textContent = `${answered} / ${sess.refs.length}`;
  const clear = $('[data-act="clear-pick"]'); if (clear) clear.disabled = !a.pick;
  for (const button of document.querySelectorAll('.sheet [data-i]')) {
    const index = +button.dataset.i;
    const aa = sess.answers[sess.refs[index].qid] || {};
    button.classList.toggle('done', !!aa.pick); button.classList.toggle('flagged', !!aa.flagged);
    button.setAttribute('aria-label', `练习第 ${index + 1} 题，${aa.pick ? '已答' : '未答'}${aa.flagged ? '，待复查' : ''}`);
  }
  const hint = $('[data-multi-hint]');
  if (hint) hint.textContent = a.pick ? `已选 ${a.pick} —— 再点一次可取消该项` : '多选题，可选择多个选项';
}

async function pickSessions(ids) {
  const all = getSessions();
  const order = new Map(all.map((s, i) => [s.id, i]));
  return ids
    .map((id) => all.find((s) => s.id === id) || (S.session?.id === id ? S.session : null))
    .filter(Boolean)
    .sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
}

async function doExport(ids, kind, how) {
  if (!ids.length) return toast('没有选中记录');
  toast(kind==='pdf'?'正在准备 PDF 与图片…':'正在生成…');
  const sessions = await prepareForExport(await pickSessions(ids));
  if (!sessions.length) return toast('没有可导出的记录');
  const opts = { expl: SETTINGS.exportExpl, material: SETTINGS.exportMat, scope: route.name === 'report' ? V.reportScope || 'all' : 'all' };
  const stamp = safeName(fmtTime(Date.now()));
  const name = sessions.length === 1 ? safeName(sessions[0].title) : `行测刷题记录_${sessions.length}次_${stamp}`;

  if (kind === 'json') {
    const txt = buildJson(sessions, opts);
    if (how === 'download') { download(name + '.json', txt, 'application/json'); toast('已下载 JSON'); }
    else if (await copyText(txt)) toast('JSON 已复制到剪贴板');
    return;
  }
  const md = buildMarkdown(sessions, opts);
  if(['zip','html','print','pdf'].includes(kind)) {
    const documents=kind==='zip'?null:reportDocuments(sessions,opts);
    const imageSource=documents?documents.flatMap(d=>d.questions.flatMap(q=>
      [q.material,q.stem,...q.options.map(o=>o.t),q.result?.explanation||''].map(h=>htmlToMd(h)))).join('\n'):md;
    const [images]=await Promise.all([
      ExportTools.images(imageSource,loadScript),
      kind==='pdf'?DocumentExport.preparePdf(documents,loadScript,message=>toast(message,60000)):null
    ]);
    if(kind==='zip') {
      const files=[{name:name+'.md',data:md},...Object.entries(images).map(([path,data])=>({name:path,data:ExportTools.decode(data)}))];
      download(name+'.zip',ExportTools.zip(files),'application/zip');
      toast('已下载 Markdown 与图片，解压后打开',3500);return;
    }
    if(kind==='pdf') {
      const bytes=await DocumentExport.pdf(documents,images,loadScript,message=>toast(message,60000));
      download(name+'_复盘.pdf',bytes,'application/pdf');toast('已下载复盘 PDF');return;
    }
    const html=DocumentExport.html(documents,images,name);
    if(kind==='print' && how && !how.closed) {
      how.document.open();how.document.write(html);how.document.close();
      await Promise.all([...how.document.images].map(img=>img.decode().catch(()=>{})));
      how.focus();how.print();
      toast('请在打印窗口选择「另存为 PDF」',4000);return;
    }
    download(name+'.html',html,'text/html;charset=utf-8');
    toast(kind==='print' ? '已下载带图网页，打开后点击「保存为 PDF」' : '已下载带图网页（单文件）',4000);return;
  }
  if (how === 'copy') {
    if (await copyText(md)) toast('已复制 Markdown 文字；图片请使用带图导出',3500);
    else { download(name + '.md', md, 'text/markdown;charset=utf-8'); toast('复制不可用，已改为下载'); }
    return;
  }
  if (how === 'both') {
    const ok = await copyText(md);
    download(name + '.md', md, 'text/markdown;charset=utf-8');
    toast(ok ? 'Markdown 已复制，同时开始下载' : '已下载 Markdown');
    return;
  }
  download(name + '.md', md, 'text/markdown;charset=utf-8');
  toast('已下载 Markdown');
}

/* 空白试卷只投影材料、题干与选项，不向文档传递答案或作答记录。 */
function printableQuestion(q, type) {
  return {type:type || q.type || '未分类', material:q.material || '',
    stem:ExamFormat.stem(q.stem, type || q.type), options:q.options.map(o => ({k:o.k, t:o.t}))};
}
function reportDocuments(sessions, opts) {
  return sessions.map(sess=>{
    const qs=sess.__questions||[],sum=summarize(sess,qs);
    return {title:sess.title,report:true,date:fmtTime(sess.submittedAt||sess.createdAt),
      summary:[`整次练习：${sum.total} 题　已答 ${sum.answered}　正确 ${sum.right}　错误 ${sum.wrong}　未答 ${sum.unanswered}`,
        `正确率：${pct(sum.right,sum.answered)}　总用时：${fmtDur(sum.totalMs)}`,
        '自评与复盘描述为考生自述，请结合题目与解析分析，不能仅凭答对判断掌握。'],
      questions:exportRows(sess,qs,opts.scope).map(r=>{
        const q=r.q;if(!q)throw new Error('题目未加载：'+r.ref.qid);
        const a=r.a,review=assessment(a,r.correct);
        return {...printableQuestion(q,r.ref.type),material:opts.material?q.material||'':'',
          result:{state:!a.pick?'未作答':r.correct?'答对':'答错',mine:a.pick||'未作答',answer:q.answer,time:fmtDur(a.ms),
            ...review,note:a.note||'',reflection:a.reflection||'',excluded:a.excluded||'',
            favorite:isFavorite(q),flagged:!!a.flagged,explanation:opts.expl?q.explanation||'':''}};
      })};
  });
}
async function pdfAction(button, action) {
  if(button.disabled)return;
  const label=button.textContent;
  button.disabled=true;button.textContent='生成中…';
  try {return await action();}
  finally {button.disabled=false;button.textContent=label;}
}
async function exportQuestions(source, id, preview, format='html') {
  toast(format==='pdf'?'正在准备 PDF 与图片…':'正在生成试题与图片…');
  let title, questions;
  if (source === 'paper') {
    const pf = await loadPaper(id);
    const sel = V.paperSel[id] || new Set(Object.keys(pf.types));
    title = pf.name;
    questions = pf.questions.filter(q => sel.has(q.type)).map(q => printableQuestion(q));
  } else {
    const [sess] = await prepareForExport(await pickSessions([id]));
    if (!sess) throw new Error('练习记录不存在');
    title = sess.title;
    const rows = exportRows(sess, sess.__questions, V.reportScope || 'all');
    if (rows.some(r => !r.q)) throw new Error('部分题目未加载，请重试');
    questions = rows.map(r => printableQuestion(r.q, r.ref.type));
  }
  if (!questions.length) {
    if (preview && !preview.closed) preview.close();
    return toast('当前范围没有题目');
  }
  const md = questions.map(q => [q.material,q.stem,...q.options.map(o => o.t)].map(h => htmlToMd(h)).join('\n')).join('\n');
  const name = safeName(title) + '_空白试题';
  const documents=[{title,questions,report:false}];
  const [images]=await Promise.all([
    ExportTools.images(md, loadScript),
    format==='pdf'?DocumentExport.preparePdf(documents,loadScript,message=>toast(message,60000)):null
  ]);
  if(format==='pdf') {
    const bytes=await DocumentExport.pdf(documents,images,loadScript,message=>toast(message,60000));
    download(name+'.pdf',bytes,'application/pdf');toast('已下载试题 PDF');return;
  }
  const html = DocumentExport.html(documents, images, name);
  if (preview && !preview.closed) {
    preview.document.open(); preview.document.write(html); preview.document.close();
    await Promise.all([...preview.document.images].map(img => img.decode()));
    preview.focus(); preview.print();
    toast('已打开空白试题，可打印或另存为 PDF', 4000);
  } else {
    download(name + '.html', html, 'text/html;charset=utf-8');
    toast('已导出含图片的打印版，打开后即可打印或保存 PDF', 4000);
  }
}

/* ---------------------------------------------------------- 事件绑定 */

/* 点击：只处理非表单元素（按钮/卡片/选项）。
   表单元素交给 change，否则 label 里的 checkbox 会被处理两次。 */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  if (el.tagName === 'A' && el.getAttribute('href')) return; // 让链接正常跳转
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  runAction(fn, e, el);
});

/** 统一的动作调用：async 动作抛错时也要能报出来，否则会静默失败 */
function runAction(fn, e, el) {
  try {
    const r = fn(e, el);
    if (r && typeof r.catch === 'function') {
      r.catch((err) => { console.error(err); toast('操作失败：' + (err?.message || err)); });
    }
  } catch (err) {
    console.error(err);
    toast('操作失败：' + (err?.message || err));
  }
}

/* 下拉框 / 复选框 / 单选 / 数字输入 */
const CHANGE_ACTS = new Set(['pf-sel', 'cy', 'ct', 'set', 'hsel', 'ctotal', 'psel-type', 'psel-module', 'showall-expl', 'auto-pause']);
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !CHANGE_ACTS.has(el.dataset.act)) return;
  runAction(ACT[el.dataset.act], e, el);
});

/* 搜索框实时过滤：重渲染后把焦点和光标还原回去 */
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act]');
  if (el?.dataset.act === 'review-description') {
    const saved = saveReflection(el.dataset.sid, el.dataset.qid, el.value);
    const status = el.closest('[data-assessment]').querySelector('.reflection-save');
    if (status) status.textContent = saved ? '已保存 · 导出时附上' : '保存失败，请保留文字后重试';
    return;
  }
  if (!el || el.dataset.act !== 'pf-q') return;
  const val = el.value;
  V.paperFilter.q = val;
  render().then(() => {
    const ni = document.querySelector('[data-act="pf-q"]');
    if (ni) { ni.focus(); try { ni.setSelectionRange(val.length, val.length); } catch { /* number 等类型 */ } }
  });
});


document.addEventListener('keydown', (e) => {
  if (route.name !== 'quiz') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const sess = S.session;
  if (!sess || $('.modal-bg')) return;
  if (e.target.closest('button,a,summary') && (e.key === 'Enter' || e.code === 'Space')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space' && !e.repeat && !e.target.closest('button, [role="checkbox"]')) { ACT['pause-quiz'](); e.preventDefault(); return; }
  if (sess.paused) return;
  const key = e.key.toUpperCase();
  let k = null;
  if (/^[ABCD]$/.test(key)) k = key;
  if (/^[1234]$/.test(key)) k = 'ABCD'[+key - 1];
  if (k) {
    const ref = sess.refs[sess.index];
    const q = QMAP.get(ref.qid);
    if (q && q.options.some((o) => o.k === k)) { (e.shiftKey ? ACT.exclude : ACT.pick)(e, { dataset: { k } }); e.preventDefault(); }
    return;
  }
  if (e.key === 'ArrowLeft') { ACT.prev(); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { ACT.next(); e.preventDefault(); }
  else if (e.key === 'Enter') { ACT.next(); e.preventDefault(); }
  else if (key === 'F') { ACT.flag(); e.preventDefault(); }
  else if (e.key === 'Escape') { ACT['exit-quiz'](); }
});

window.addEventListener('beforeunload', () => { flushTime(); saveActive(); });
window.addEventListener('pagehide', () => { flushTime(); S.shownAt = 0; saveActive(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushTime();
    if (SETTINGS.autoPause && S.session && route.name === 'quiz') { S.session.paused = true; S.shownAt = 0; render(); }
    saveActive();
  }
  syncClock();
});
setInterval(syncClock, 250);
setInterval(() => { if (S.session && S.shownAt) saveActive(); }, 5000);
window.addEventListener('hashchange', render);
window.addEventListener('storage', e => {
  if (e.key !== K.sessions || !S.session) return;
  const id = S.session.id;
  if (!getSessions().some(s => s.id === id)) return;
  S.session = null; S.shownAt = 0;
  if (store.get(K.active, null)?.id === id) store.del(K.active);
  go('#/report/' + id);
  toast('这次练习已在另一标签交卷');
});

/* ---------------------------------------------------------- 启动 */

window.CloudSync?.bind({
  isBusy:()=>route.name==='quiz'&&!!S.session&&!S.session.submitted,
  onRemote:()=>{
    SETTINGS={...DEFAULT_SETTINGS,...store.get(K.settings,{})};
    if(route.name!=='quiz'&&!document.activeElement?.matches('input,textarea,select')&&!$('.modal-bg')){
      S.session=store.get(K.active,null);S.shownAt=0;render();
    }
  }
});

if (!CAT) {
  app.innerHTML = emptyBox(ExamTools.icon('file'), '数据未加载', '请先运行 node tools/build.mjs 生成 data/ 目录');
} else {
  // 默认选中言语理解三个题型，减少点选成本
  CAT.typeOrder.filter((t) => moduleOfType(t) === '言语理解与表达').forEach((t) => V.custom.types.add(t));
  V.custom.total = 30;
  const oldSessions = getSessions();
  if (oldSessions.some(s => s.meta?.rows)) setSessions(oldSessions);
  S.session = store.get(K.active, null);
  if (S.session && (S.session.submitted || oldSessions.some(s => s.id === S.session.id))) { S.session = null; store.del(K.active); }
  S.shownAt = 0;
  render();
}
