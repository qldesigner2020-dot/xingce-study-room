/* Shared by the offline browser and the Node data builder. */
(function (root) {
  'use strict';
  function stem(html, type = '') {
    const source = String(html || '');
    const fill = type === '逻辑填空' || /填入[^<\n]{0,24}(横线|空白|空缺)/.test(source);
    return source.split(/(<span\b[^>]*class="exam-ellipsis"[^>]*>[\s\S]*?<\/span>|<[^>]+>)/g).map((part) => {
      if (part.startsWith('<')) return part;
      // Keep source text length so existing text marks and ink anchors remain
      // valid. CSS displays the six separate dots as one Chinese ellipsis.
      let text = part.replace(/(?:[·•・]{6}|\.{6}|…{2})/g,
        dots=>'<span class="exam-ellipsis" aria-label="省略号">'+dots+'</span>')
        .replace(/_{3,}/g, '<span class="exam-blank" aria-label="填空横线">&nbsp;</span>');
      if (fill) {
        text = text.replace(/(?:[ \u00a0\u3000]|&nbsp;){3,}/g, (spaces, offset, whole) => {
          // A paragraph indent is not an answer blank.
          if (!whole.slice(0, offset).trim() || !whole.slice(offset + spaces.length).trim()) return spaces;
          return '<span class="exam-blank" aria-label="填空横线">&nbsp;</span>';
        });
      }
      return text;
    }).join('');
  }
  const api = { stem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExamFormat = api;
})(globalThis);
