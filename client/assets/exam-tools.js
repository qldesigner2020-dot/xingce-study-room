/* Paper annotations: stored text ranges and anchored vector ink, no dependencies. */
'use strict';
const ExamTools = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  let tool = 'select';
  let inkColor = '#b54836';
  let originals = new WeakMap();
  let observer;
  let drawing = null;
  let suppressClickUntil = 0;
  const history = new Map();
  const paths = {
    cursor: '<path d="m4 3 7.5 18 2.5-7 7-2.5L4 3Z"/>',
    pen: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m14 5 5 5"/>',
    underline: '<path d="M5 3v7a7 7 0 0 0 14 0V3M4 21h16"/>',
    highlight: '<path d="m9 11 6-8 6 6-8 6-4-4ZM9 11l-5 5 4 4 5-5M3 22h7"/>',
    eraser: '<path d="m16 3 5 5-12 12H5l-3-3L16 3ZM8 11l5 5M12 20h9"/>',
    undo: '<path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
    file: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h8"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
    chart: '<path d="M3 3v18h18M7 15V9M12 15V5M17 15v-3"/>',
  };
  const icon = (name) => `<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  function toolbar() {
    const tools = [['select', '作答'], ['pen', '手写笔'], ['underline', '划线'], ['highlight', '高亮'], ['eraser', '橡皮']];
    return `<div class="annotation-toolbar" role="toolbar" aria-label="题面标注工具">
      <div class="tool-buttons">${tools.map(([id, label]) => `<button class="btn btn-sm ${['underline','highlight','eraser'].includes(id) ? 'extended-tool' : ''} ${tool === id ? 'active' : ''}" data-exam-tool="${id}" aria-pressed="${tool === id}" title="${id === 'underline' || id === 'highlight' ? '拖选文字后标注' : label}">${label}</button>`).join('')}<button class="btn btn-sm clear-ink" data-exam-command="clear-ink" title="清空本题全部手写笔迹，可撤销" disabled>清空笔迹</button></div>
      <div class="tool-extras"><button class="btn btn-sm" data-exam-command="undo" title="撤销本题最近一次标注">撤销</button>
      <details class="action-menu tool-menu"><summary class="btn btn-sm"><span data-tool-more>更多</span></summary><div class="menu-body"><div class="mobile-annotation-tools"><button class="btn" data-exam-tool="underline" aria-pressed="${tool === 'underline'}">划线</button><button class="btn" data-exam-tool="highlight" aria-pressed="${tool === 'highlight'}">高亮</button><button class="btn" data-exam-tool="eraser" aria-pressed="${tool === 'eraser'}">橡皮</button></div><button class="btn btn-ghost" data-exam-command="clear">清除全部标注</button><div class="ink-colors">
      <button class="ink-swatch" data-exam-color="#b54836" aria-label="红色笔" aria-pressed="${inkColor === '#b54836'}" style="--swatch:#b54836"></button><button class="ink-swatch" data-exam-color="#252a26" aria-label="黑色笔" aria-pressed="${inkColor === '#252a26'}" style="--swatch:#252a26"></button>
      </div><label class="paper-size">字号 <select data-paper-size aria-label="试卷字号">${[16, 18, 19, 20, 22, 24].map(n => `<option value="${n}" ${SETTINGS.paperSize === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="btn btn-ghost" data-exam-command="fullscreen">全屏专注</button></div></details></div></div>`;
  }
  function current() {
    if (typeof S === 'undefined' || !S.session || S.session.paused || S.session.submitted || route.name !== 'quiz' || document.querySelector('.modal-bg')) return null;
    return ansOf(S.session, S.session.refs[S.session.index].qid);
  }
  function annotations(a) {
    return (a.annotations ||= { version: 1, marks: [], strokes: [] });
  }
  function checkpoint(a) {
    const key = S.session.id + ':' + S.session.refs[S.session.index].qid;
    const list = history.get(key) || [];
    list.push(JSON.stringify(annotations(a)));
    history.set(key, list.slice(-25));
  }
  function textNodes(zone) {
    const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.parentElement.closest('svg,button,.annotation-hint') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    const nodes = []; let node; let offset = 0;
    while ((node = walker.nextNode())) {
      nodes.push({node, start:offset, end:offset + node.length}); offset += node.length;
    }
    return nodes;
  }
  function textOffset(zone, node, offset) {
    const nodes = textNodes(zone);
    const found = nodes.find(n => n.node === node);
    if (found) return found.start + offset;
    // Browser selections can end at an element rather than a text node.
    const range = document.createRange(); range.selectNodeContents(zone);
    try { range.setEnd(node, offset); return range.toString().length; } catch { return null; }
  }
  function anchorRect(zone, offset) {
    const nodes = textNodes(zone);
    const found = nodes.find(n => offset >= n.start && offset < n.end) || nodes.at(-1);
    if (!found) return null;
    const index = Math.min(found.node.length - 1, Math.max(0, offset - found.start));
    if (index < 0) return null;
    const range = document.createRange(); range.setStart(found.node, index); range.setEnd(found.node, index + 1);
    return range.getBoundingClientRect();
  }
  function applyMark(zone, mark) {
    for (const item of textNodes(zone).reverse()) {
      const start = Math.max(mark.start, item.start), end = Math.min(mark.end, item.end);
      if (end <= start) continue;
      const range = document.createRange(); range.setStart(item.node, start - item.start); range.setEnd(item.node, end - item.start);
      const span = document.createElement('span'); span.className = 'user-mark ' + mark.kind;
      span.dataset.markId = mark.id; span.title = '双击删除标注';
      range.surroundContents(span);
    }
  }
  // Keep text offsets relative to .t for existing annotations, while ink covers
  // the complete option row. Stroke coordinates remain anchored to that text.
  const inkSurface = zone => zone.closest('.opt') || zone;
  const inkLayer = zone => inkSurface(zone).querySelector(':scope > .ink-layer');
  function makeSvg(zone, ann) {
    const surface = inkSurface(zone);
    inkLayer(zone)?.remove();
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('ink-layer'); svg.setAttribute('aria-hidden', 'true');
    svg.dataset.zone = zone.dataset.markZone;
    const bounds = surface.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`);
    for (const stroke of ann.strokes.filter(s => s.zone === zone.dataset.markZone)) {
      const origin = anchorRect(zone, stroke.anchor);
      const font = parseFloat(getComputedStyle(zone).fontSize);
      const textBounds = zone.getBoundingClientRect();
      const baseX = (origin || textBounds).left - bounds.left;
      const baseY = (origin || textBounds).top - bounds.top;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', stroke.points.map((p, i) => `${i ? 'L' : 'M'}${(baseX + p[0] * font).toFixed(2)},${(baseY + p[1] * font).toFixed(2)}`).join(' '));
      path.setAttribute('stroke', stroke.color); path.setAttribute('stroke-width', String(stroke.width || 2));
      path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      path.dataset.strokeId = stroke.id; svg.appendChild(path);
    }
    surface.appendChild(svg);
  }
  function paintZone(zone, ann) {
    if (!originals.has(zone)) originals.set(zone, zone.innerHTML);
    zone.innerHTML = originals.get(zone);
    for (const mark of ann.marks.filter(m => m.zone === zone.dataset.markZone)) applyMark(zone, mark);
    makeSvg(zone, ann);
  }
  function repaint() {
    const a = current(); if (!a) return;
    for (const zone of document.querySelectorAll('.exam-view [data-mark-zone]')) paintZone(zone, annotations(a));
    setToolClasses();
  }
  function setToolClasses() {
    const paper = document.querySelector('.exam-paper');
    if (paper) paper.dataset.annotationTool = tool;
    document.querySelectorAll('[data-exam-tool]').forEach(b => { b.classList.toggle('active', b.dataset.examTool === tool); b.setAttribute('aria-pressed', String(b.dataset.examTool === tool)); });
    const more = document.querySelector('[data-tool-more]');
    if (more) { more.textContent = tool === 'underline' ? '划线' : tool === 'highlight' ? '高亮' : tool === 'eraser' ? '橡皮' : '更多'; more.parentElement.classList.toggle('active', ['underline','highlight','eraser'].includes(tool)); }
    const clearInk = document.querySelector('[data-exam-command="clear-ink"]');
    if (clearInk) clearInk.disabled = !current()?.annotations?.strokes?.length;
    document.querySelectorAll('[data-exam-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.examColor === inkColor)));
  }
  function mount() {
    drawing = null; originals = new WeakMap(); suppressClickUntil = 0;
    if (observer) observer.disconnect();
    const a = current();
    if (a) repaint();
    for (const detail of document.querySelectorAll('[data-review-qid]')) {
      const aa = api.reviewSession?.answers[detail.dataset.reviewQid];
      if (aa?.annotations) for (const zone of detail.querySelectorAll('[data-mark-zone]')) paintZone(zone, aa.annotations);
    }
    // Observe content dimensions, so ink follows image load, font size and responsive reflow.
    observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const zone = entry.target.matches('[data-mark-zone]') ? entry.target : entry.target.querySelector('[data-mark-zone]');
        if (!zone) continue;
        const aa = zone.closest('[data-review-qid]') ? api.reviewSession?.answers[zone.closest('[data-review-qid]').dataset.reviewQid] : current();
        if (!aa?.annotations || drawing?.zone === zone) continue;
        makeSvg(zone, aa.annotations);
      }
    });
    document.querySelectorAll('[data-mark-zone]').forEach(z => { observer.observe(z); if (inkSurface(z) !== z) observer.observe(inkSurface(z)); });
    setToolClasses();
    const sheet = document.querySelector('.sheet-panel');
    if (sheet && window.innerWidth <= 760) sheet.open = false;
    // Annotation layers have to be redrawn when closed report details become visible.
    document.querySelectorAll('.qitem').forEach(detail => detail.addEventListener('toggle', () => {
      if (detail.open) window.dispatchEvent(new Event('resize'));
    }));
  }
  function save() { saveActive(); const status = document.querySelector('[data-save-status]'); if (status) status.textContent = '已保存进度、草稿和标注'; }
  function undo() {
    const a = current(); if (!a) return;
    const key = S.session.id + ':' + S.session.refs[S.session.index].qid;
    const list = history.get(key);
    if (list?.length) a.annotations = JSON.parse(list.pop());
    else {
      const ann = annotations(a), latest = [...ann.marks, ...ann.strokes].sort((x,y) => y.at - x.at)[0];
      if (!latest) return toast('本题没有可撤销的标注');
      ann.marks = ann.marks.filter(m => m.id !== latest.id); ann.strokes = ann.strokes.filter(s => s.id !== latest.id);
    }
    repaint(); save();
  }
  function removeMark(id, stroke = false) {
    const a = current(); if (!a) return;
    checkpoint(a); const ann = annotations(a);
    if (stroke) ann.strokes = ann.strokes.filter(s => s.id !== id);
    else ann.marks = ann.marks.filter(m => m.id !== id);
    repaint(); save();
  }
  function caretAt(zone, x, y) {
    const svg = inkLayer(zone);
    if (svg) svg.style.display = 'none';
    let node, offset;
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); node = c?.offsetNode; offset = c?.offset; }
    else if (document.caretRangeFromPoint) { const c = document.caretRangeFromPoint(x, y); node = c?.startContainer; offset = c?.startOffset; }
    if (svg) svg.style.display = '';
    return node && zone.contains(node) ? (textOffset(zone, node, offset) ?? 0) : 0;
  }
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.action-menu[open]').forEach(menu => { if (!menu.contains(e.target)) menu.open = false; });
    const button = e.target.closest('[data-exam-tool], [data-exam-command], [data-exam-color]');
    if (button) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (button.dataset.examTool) { tool = button.dataset.examTool; setToolClasses(); const menu = button.closest('.tool-menu'); if (menu) menu.open = false; }
      if (button.dataset.examColor) { inkColor = button.dataset.examColor; setToolClasses(); }
      const command = button.dataset.examCommand;
      if (command === 'undo') undo();
      if (command === 'clear-ink') {
        const a = current();
        if (a?.annotations?.strokes?.length) { checkpoint(a); a.annotations.strokes = []; repaint(); save(); }
      }
      if (command === 'clear') {
        const a = current(); if (a) { checkpoint(a); a.annotations = {version:1, marks:[], strokes:[]}; repaint(); save(); }
      }
      if (command === 'fullscreen') {
        if (document.fullscreenElement) document.exitFullscreen().catch(err => toast(err.message));
        else document.documentElement.requestFullscreen().catch(() => { document.body.classList.toggle('focus-mode'); toast('已切换专注布局'); });
      }
      return;
    }
    if (e.target.closest('.exam-view .opt') && !e.target.closest('.exclude-btn') && (performance.now() < suppressClickUntil || tool !== 'select')) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('change', e => {
    if (e.target.matches('[data-paper-size]')) {
      SETTINGS.paperSize = +e.target.value; saveSettings();
      document.querySelector('.exam-view')?.style.setProperty('--paper-size', `${SETTINGS.paperSize}px`);
    }
  });
  document.addEventListener('input', e => {
    if (e.target.matches('[data-act="question-note"]')) {
      const a = current(); if (a) { a.note = e.target.value; save(); }
    }
  });
  document.addEventListener('dblclick', e => {
    const mark = e.target.closest('.exam-view .user-mark');
    if (mark) { e.preventDefault(); removeMark(mark.dataset.markId); }
  });
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const zone = e.target.closest('.exam-view [data-mark-zone]') || e.target.closest('.exam-view .opt')?.querySelector('[data-mark-zone]');
    if (!zone || !current()) return;
    if (tool === 'eraser') {
      const path = e.target.closest('[data-stroke-id]'), mark = e.target.closest('[data-mark-id]');
      if (path) removeMark(path.dataset.strokeId, true);
      else if (mark) removeMark(mark.dataset.markId);
      e.preventDefault(); suppressClickUntil = performance.now() + 600; return;
    }
    if (tool !== 'pen' || e.button !== 0) return;
    e.preventDefault();
    const anchor = caretAt(zone, e.clientX, e.clientY);
    const rect = anchorRect(zone, anchor) || zone.getBoundingClientRect();
    const font = parseFloat(getComputedStyle(zone).fontSize);
    const svg = inkLayer(zone);
    if (!svg) return;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('fill','none'); path.setAttribute('stroke',inkColor); path.setAttribute('stroke-width','2'); path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round');
    svg.appendChild(path); svg.setPointerCapture(e.pointerId);
    drawing = {zone, svg, path, pointer:e.pointerId, rect, font, zoneRect:inkSurface(zone).getBoundingClientRect(), stroke:{id:'ink-'+newId(),at:Date.now(),zone:zone.dataset.markZone,anchor,color:inkColor,width:2,points:[]}};
    addPoint(e);
  });
  function addPoint(e) {
    if (!drawing || e.pointerId !== drawing.pointer) return;
    const d = drawing;
    d.stroke.points.push([(e.clientX-d.rect.left)/d.font,(e.clientY-d.rect.top)/d.font]);
    // Bound ink size without cutting off a long pointer gesture.
    if (d.stroke.points.length > 1600) d.stroke.points = d.stroke.points.filter((_,i) => i % 2 === 0);
    d.path.setAttribute('d', d.stroke.points.map((p,i) => `${i ? 'L' : 'M'}${(d.rect.left-d.zoneRect.left+p[0]*d.font).toFixed(2)},${(d.rect.top-d.zoneRect.top+p[1]*d.font).toFixed(2)}`).join(' '));
  }
  document.addEventListener('pointermove', e => { if (drawing) { e.preventDefault(); addPoint(e); } });
  function finishDrawing(e) {
    if (!drawing || e.pointerId !== drawing.pointer) return;
    const a = current(), d = drawing; drawing = null;
    if (d.svg.hasPointerCapture(e.pointerId)) d.svg.releasePointerCapture(e.pointerId);
    if (a && d.stroke.points.length > 1) { checkpoint(a); annotations(a).strokes.push(d.stroke); d.path.dataset.strokeId = d.stroke.id; save(); }
    else d.path.remove();
    setToolClasses();
    suppressClickUntil = performance.now() + 600;
  }
  document.addEventListener('pointercancel', finishDrawing);
  document.addEventListener('pointerup', e => {
    if (drawing) { finishDrawing(e); return; }
    const a = current(); if (!a) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const zone = startElement.closest('.exam-view [data-mark-zone]');
    if (!zone || !zone.contains(range.endContainer)) return;
    // Selecting text in an option never chooses that option, even in selection mode.
    suppressClickUntil = performance.now() + 600;
    if (!['underline','highlight'].includes(tool)) return;
    const start = textOffset(zone, range.startContainer, range.startOffset), end = textOffset(zone, range.endContainer, range.endOffset);
    if (start == null || end == null || start >= end) return;
    checkpoint(a); annotations(a).marks.push({id:'mark-'+newId(),at:Date.now(),zone:zone.dataset.markZone,start,end,kind:tool});
    selection.removeAllRanges(); repaint(); save();
  });
  document.addEventListener('keydown', e => {
    const menu = document.querySelector('.action-menu[open]');
    if (e.key === 'Escape' && menu) { menu.open = false; menu.querySelector('summary')?.focus(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    const dialog = document.querySelector('.modal[role="dialog"]');
    if (dialog) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ACT['close-modal'](); return; }
      if (e.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input,textarea,select,[tabindex="0"]')];
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (typeof route === 'undefined' || route.name !== 'quiz') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'Escape' && tool !== 'select') { tool = 'select'; setToolClasses(); e.stopImmediatePropagation(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.opt[data-k]')) { e.preventDefault(); e.stopImmediatePropagation(); ACT.pick(e, e.target); }
  }, true);
  const api = {toolbar, mount, icon, reviewSession:null};
  return api;
})();
