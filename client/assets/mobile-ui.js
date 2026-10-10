/* Viewport helpers only; no storage, routing or account changes. */
(function(root) {
  'use strict';
  let observer;
  let restingHeight = root.innerHeight, lastWidth = root.innerWidth;
  const html = document.documentElement;
  function measure() {
    const bar = document.querySelector('.quizbar');
    html.style.setProperty('--quizbar-height', (bar?.getBoundingClientRect().height || 0) + 'px');
    const viewport = root.visualViewport;
    const editing = document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]),textarea');
    // Some Android browsers resize the layout too, while iOS only resizes the
    // visual viewport. Retain the height before editing for both behaviors.
    if (Math.abs(root.innerWidth - lastWidth) > 80 || !editing) restingHeight = root.innerHeight;
    else restingHeight = Math.max(restingHeight, root.innerHeight);
    lastWidth = root.innerWidth;
    const keyboard = !!editing && !!viewport && viewport.scale === 1 && restingHeight - viewport.height > 140;
    html.classList.toggle('mobile-keyboard', keyboard);
    if (!viewport || viewport.scale === 1) {
      html.style.setProperty('--visible-height', (viewport?.height || root.innerHeight) + 'px');
      html.style.setProperty('--visible-top', (viewport?.offsetTop || 0) + 'px');
    }
  }
  function mount() {
    observer?.disconnect();
    const bar = document.querySelector('.quizbar');
    if (bar && root.ResizeObserver) { observer = new ResizeObserver(measure); observer.observe(bar); }
    html.classList.toggle('has-modal', !!document.querySelector('.modal-bg'));
    measure();
  }
  root.addEventListener('resize', measure, {passive:true});
  root.visualViewport?.addEventListener('resize', measure, {passive:true});
  root.visualViewport?.addEventListener('scroll', measure, {passive:true});
  document.addEventListener('focusin', measure);
  document.addEventListener('focusout', () => setTimeout(measure, 0));
  // Dismiss menus on outside tap, without intercepting option or pen events.
  document.addEventListener('click', event => {
    document.querySelectorAll('.action-menu[open]').forEach(menu => {
      if (!menu.contains(event.target) || event.target.closest('[data-exam-tool]')) menu.open = false;
    });
  });
  root.MobileUI = {mount};
})(window);
