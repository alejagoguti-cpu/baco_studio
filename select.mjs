// Lista desplegable propia: reemplaza visualmente los <select> nativos (cuyo menú no se puede estilizar)
// y mantiene el <select> original para formularios, validación y eventos «change».
const enhanced = new Set();
let openState = null;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chevron = '<svg class="cs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const check = '<svg class="cs-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function label(select) { const o = select.options[select.selectedIndex]; return o ? o.textContent : ''; }

export function syncSelects(root = document) {
  for (const select of enhanced) {
    if (!select.isConnected) { enhanced.delete(select); continue; }
    if (!root.contains(select)) continue;
    const button = select._csButton;
    button.querySelector('.cs-value').textContent = label(select) || select.dataset.placeholder || 'Seleccionar';
    button.classList.toggle('cs-placeholder', !select.value);
    button.disabled = select.disabled;
  }
}

function close(focus = true) {
  if (!openState) return;
  const {select, panel} = openState;
  panel.remove(); select._csButton.setAttribute('aria-expanded', 'false');
  select._csButton.classList.remove('open');
  if (focus) select._csButton.focus();
  openState = null;
}

function choose(select, value) {
  if (select.value !== value) { select.value = value; select.dispatchEvent(new Event('change', {bubbles:true})); select.dispatchEvent(new Event('input', {bubbles:true})); }
  syncSelects(select.parentElement);
  close();
}

function position(button, panel) {
  const r = button.getBoundingClientRect(), gap = 6;
  const below = innerHeight - r.bottom - 12, above = r.top - 12;
  const maxH = Math.min(300, Math.max(below, above) - gap);
  panel.style.maxHeight = `${Math.max(140, maxH)}px`;
  panel.style.minWidth = `${r.width}px`;
  panel.style.left = `${Math.min(r.left, innerWidth - Math.max(r.width, panel.offsetWidth) - 8)}px`;
  if (below >= Math.min(220, panel.scrollHeight) || below >= above) { panel.style.top = `${r.bottom + gap}px`; panel.style.bottom = ''; }
  else { panel.style.bottom = `${innerHeight - r.top + gap}px`; panel.style.top = ''; }
}

function open(select, opts) {
  close(false);
  const button = select._csButton;
  const panel = document.createElement('div');
  panel.className = 'cs-panel'; panel.setAttribute('role', 'listbox'); panel.tabIndex = -1;
  const items = [...select.options].map((o, i) => `<div class="cs-option ${o.value === select.value ? 'selected' : ''} ${o.value === '' ? 'cs-empty' : ''}" role="option" data-i="${i}" aria-selected="${o.value === select.value}">${check}<span>${esc(o.textContent)}</span>${opts.removable?.(o.value) ? `<button type="button" class="cs-remove" data-remove="${esc(o.value)}" aria-label="Eliminar ${esc(o.textContent)}">×</button>` : ''}</div>`).join('');
  const adder = opts.onAdd ? `<div class="cs-add"><button type="button" class="cs-add-open">+ ${esc(opts.addLabel || 'Agregar opción')}</button><form class="cs-add-form" hidden><input maxlength="60" placeholder="${esc(opts.addPlaceholder || 'Escribe el nombre')}" aria-label="${esc(opts.addLabel || 'Nueva opción')}"><button type="submit">Agregar</button></form><p class="cs-add-error" hidden></p></div>` : '';
  panel.innerHTML = `<div class="cs-list">${items}</div>${adder}`;
  (select.closest('dialog[open]') || document.body).append(panel);
  button.setAttribute('aria-expanded', 'true'); button.classList.add('open');
  position(button, panel);
  let active = Math.max(0, select.selectedIndex);
  const options = [...panel.querySelectorAll('.cs-option')];
  const setActive = i => { active = (i + options.length) % options.length; options.forEach((o, k) => o.classList.toggle('active', k === active)); options[active]?.scrollIntoView({block:'nearest'}); };
  setActive(active);
  panel.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  panel.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.stopPropagation(); const msg = opts.onRemove?.(rm.dataset.remove); if (msg) { const p = panel.querySelector('.cs-add-error'); if (p) { p.textContent = msg; p.hidden = false; } } else { close(false); open(select, opts); } return; }
    const opt = e.target.closest('.cs-option'); if (opt) return choose(select, select.options[opt.dataset.i].value);
    if (e.target.closest('.cs-add-open')) { const form = panel.querySelector('.cs-add-form'); form.hidden = false; e.target.hidden = true; form.querySelector('input').focus(); position(button, panel); }
  });
  panel.querySelector('.cs-add-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.querySelector('input'), err = panel.querySelector('.cs-add-error');
    try { const value = opts.onAdd(input.value); choose(select, value); }
    catch (error) { err.textContent = error.message; err.hidden = false; input.focus(); }
  });
  panel.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') { e.preventDefault(); close(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(select, select.options[active].value); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key.length === 1) { const k = e.key.toLowerCase(); const i = options.findIndex((o, n) => n > active && o.textContent.trim().toLowerCase().startsWith(k)); const j = i >= 0 ? i : options.findIndex(o => o.textContent.trim().toLowerCase().startsWith(k)); if (j >= 0) setActive(j); }
  });
  openState = {select, panel};
  panel.focus({preventScroll:true});
}

export function enhanceSelects(root = document, configFor = () => ({})) {
  for (const select of root.querySelectorAll('select:not([data-cs])')) {
    select.dataset.cs = '1';
    const opts = configFor(select) || {};
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'cs-button'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    const lbl = select.getAttribute('aria-label') || select.closest('label')?.childNodes[0]?.textContent?.trim();
    if (lbl) button.setAttribute('aria-label', lbl);
    button.innerHTML = `<span class="cs-value"></span>${chevron}`;
    select.classList.add('cs-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    select.after(button); select._csButton = button;
    button.addEventListener('click', () => openState?.select === select ? close() : open(select, opts));
    button.addEventListener('keydown', e => { if (['ArrowDown','ArrowUp','Enter',' '].includes(e.key)) { e.preventDefault(); open(select, opts); } });
    select.addEventListener('change', () => syncSelects(select.parentElement));
    select.addEventListener('invalid', () => button.classList.add('cs-invalid'));
    new MutationObserver(() => syncSelects(select.parentElement)).observe(select, {childList:true, subtree:true});
    enhanced.add(select);
  }
  syncSelects(root);
}

document.addEventListener('mousedown', e => { if (openState && !openState.panel.contains(e.target) && e.target !== openState.select._csButton && !openState.select._csButton.contains(e.target)) close(false); }, true);
addEventListener('resize', () => close(false));
document.addEventListener('scroll', e => { if (openState && !openState.panel.contains(e.target)) close(false); }, true);
document.addEventListener('close', () => close(false), true);
