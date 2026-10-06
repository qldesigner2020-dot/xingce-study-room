/* Shared by the offline browser and the Node data builder. */
(function (root) {
  'use strict';
  function stem(html, type = '') {
    const source = String(html || '');
    const fill = type === '逻辑填空' || /填入[^<\n]{0,24}(横线|空白|空缺)/.test(source);
    return source.split(/(<[^>]+>)/g).map((part) => {
      if (part.startsWith('<')) return part;
      let text = part.replace(/_{3,}/g, '<span class="exam-blank" aria-label="填空横线">&nbsp;</span>');
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
