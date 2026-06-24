let _menu = null;

function build() {
  const el = document.createElement('div');
  el.className = 'ctx-menu';
  document.body.appendChild(el);
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return el;
}

function close() {
  if (_menu) _menu.style.display = 'none';
}

export function showContextMenu(x, y, items) {
  if (!_menu) _menu = build();
  _menu.innerHTML = items.map(item =>
    item === 'sep'
      ? '<div class="ctx-sep"></div>'
      : `<div class="ctx-item${item.danger ? ' ctx-danger' : ''}" data-action="${item.action}">${item.label}</div>`
  ).join('');
  _menu.style.display = 'block';
  _menu.style.left = '0';
  _menu.style.top = '0';

  const mw = _menu.offsetWidth, mh = _menu.offsetHeight;
  const left = x + mw > window.innerWidth ? x - mw : x;
  const top = y + mh > window.innerHeight ? y - mh : y;
  _menu.style.left = Math.max(4, left) + 'px';
  _menu.style.top = Math.max(4, top) + 'px';

  _menu.querySelectorAll('.ctx-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = items.find(i => i !== 'sep' && i.action === el.dataset.action);
      if (item) item.onClick();
      close();
    });
  });
}
