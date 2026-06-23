let _openCsel = null;

function closeOpen() {
  if (_openCsel) { _openCsel.classList.remove('csel-open'); _openCsel = null; }
}
document.addEventListener('click', closeOpen);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOpen(); });

export function customSelectHtml(id, options, value, extraClass = '') {
  const cur = options.find(o => o.value === value) || options[0];
  const optsHtml = options.map(o =>
    `<div class="csel-opt${o.value === value ? ' csel-opt-sel' : ''}" data-value="${o.value}">${o.label}</div>`
  ).join('');
  return `<div class="csel${extraClass ? ' ' + extraClass : ''}" id="${id}" data-value="${value}" tabindex="0" role="combobox">
    <span class="csel-label">${cur ? cur.label : ''}</span>
    <svg class="csel-chevron" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="csel-popup" role="listbox">${optsHtml}</div>
  </div>`;
}

export function wireCustomSelect(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = el.classList.contains('csel-open');
    closeOpen();
    if (!isOpen) { el.classList.add('csel-open'); _openCsel = el; }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
  el.querySelector('.csel-popup').addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = e.target.closest('.csel-opt');
    if (!opt) return;
    const value = opt.dataset.value;
    el.dataset.value = value;
    el.querySelector('.csel-label').textContent = opt.textContent;
    el.querySelectorAll('.csel-opt').forEach(o => o.classList.toggle('csel-opt-sel', o === opt));
    closeOpen();
    onChange(value);
  });
}
