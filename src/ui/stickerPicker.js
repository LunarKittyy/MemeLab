import { state } from '../core/state.js';
import { defaultTextLayer, defaultImageLayer } from '../core/layers.js';
import { pushHistory } from '../core/history.js';
import { scheduleRender } from '../render/renderer.js';
import { selectLayer } from '../interactions/pointer.js';
import { renderLayerList, setLastCreatedLayerId } from './layerList.js';
import { openPanelMobile } from './toolbar.js';

const EMOJI_LIST = [
  '😀','😂','🤣','😍','🥰','😎','🤔','😅','😭','😤',
  '🤯','🥳','😇','🤩','😜','😏','😬','🙄','😱','😡',
  '🤮','🥺','😴','🥴','🤗','😤','😈','👿','💀','☠️',
  '❤️','🧡','💛','💚','💙','💜','🖤','❤️‍🔥','💔','💯',
  '🔥','✨','⭐','🌟','💫','💥','🎉','🎊','🎈','🏆',
  '👑','💎','🍕','🍔','🌮','🍟','🍩','🍪','🎂','🍰',
  '🦄','🐶','🐱','🐸','🐔','🦊','🐼','🐨','🐮','🐷',
  '👍','👎','👏','🙌','🤝','✌️','🤞','💪','🫶','🤌',
  '🚀','🛸','🌈','⚡','🌊','🌸','🌺','🌻','🍀','🌴',
  '😤','😩','🤬','😵','🤑','🤓','🧐','🥸','😶','🫡',
];

const EMOJI_FONT = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

// Built-in sticker manifest — PNG files in assets/stickers/
const STICKER_FILES = [
  'star.png', 'heart.png', 'fire.png', 'thumbsup.png', 'crown.png',
  'lightning.png', 'rainbow.png', 'explosion.png', 'trophy.png', 'diamond.png',
];

let pickerEl = null;
let activeTab = 'emoji';

function createPicker() {
  const el = document.createElement('div');
  el.id = 'stickerPickerPopover';
  el.className = 'sticker-picker-popover';
  el.innerHTML = buildPickerHtml();
  document.body.appendChild(el);
  wirePickerEvents(el);
  return el;
}

function buildPickerHtml() {
  const emojiGrid = EMOJI_LIST.map(
    (e) => `<button class="sticker-emoji-btn" data-emoji="${e}" title="${e}">${e}</button>`
  ).join('');

  const stickerGrid = STICKER_FILES.map(
    (f) => `<button class="sticker-img-btn" data-file="${f}" title="${f.replace('.png','')}"><img src="assets/stickers/${f}" alt="${f.replace('.png','')}" loading="lazy"></button>`
  ).join('');

  return `
    <div class="sticker-picker-tabs">
      <button class="sticker-tab ${activeTab === 'emoji' ? 'active' : ''}" data-tab="emoji">Emoji</button>
      <button class="sticker-tab ${activeTab === 'stickers' ? 'active' : ''}" data-tab="stickers">Stickers</button>
      <button class="sticker-close-btn" title="Close">&times;</button>
    </div>
    <div class="sticker-tab-body">
      <div class="sticker-grid sticker-grid-emoji" style="${activeTab !== 'emoji' ? 'display:none' : ''}">
        ${emojiGrid}
      </div>
      <div class="sticker-grid sticker-grid-stickers" style="${activeTab !== 'stickers' ? 'display:none' : ''}">
        ${stickerGrid}
      </div>
    </div>
  `;
}

function wirePickerEvents(el) {
  // Tab switching
  el.querySelectorAll('.sticker-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      el.innerHTML = buildPickerHtml();
      wirePickerEvents(el);
    });
  });

  // Close
  el.querySelector('.sticker-close-btn').addEventListener('click', closePicker);

  // Emoji buttons
  el.querySelectorAll('.sticker-emoji-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      insertEmojiLayer(btn.dataset.emoji);
      closePicker();
    });
  });

  // Sticker buttons
  el.querySelectorAll('.sticker-img-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      insertStickerLayer(btn.dataset.file);
      closePicker();
    });
  });
}

function insertEmojiLayer(emoji) {
  const l = defaultTextLayer();
  l.text = emoji;
  l.font = EMOJI_FONT;
  l.sizeScale = 0.7;
  l.align = 'center';
  l.vAlign = 'middle';
  l.stroke = { enabled: false, color: '#000000', width: 0 };
  l.arc = 0;
  state.layers.push(l);
  setLastCreatedLayerId(l.id);
  renderLayerList();
  selectLayer(l.id);
  scheduleRender();
  pushHistory('Add emoji');
  openPanelMobile('right', true);
}

function insertStickerLayer(filename) {
  const url = `assets/stickers/${filename}`;
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('Sticker fetch failed: ' + r.status);
      return r.blob();
    })
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }))
    .then((dataUrl) => {
      const img = new Image();
      img.onload = () => {
        const l = defaultImageLayer(dataUrl, img.naturalWidth, img.naturalHeight);
        state.layers.push(l);
        setLastCreatedLayerId(l.id);
        renderLayerList();
        selectLayer(l.id);
        scheduleRender();
        pushHistory('Add sticker');
        openPanelMobile('right', true);
      };
      img.onerror = () => console.warn('Sticker image probe failed for', filename);
      img.src = dataUrl;
    })
    .catch((e) => console.warn('Sticker insert failed:', e));
}

export function toggleStickerPicker(anchorBtn) {
  if (pickerEl && document.body.contains(pickerEl)) {
    closePicker();
    return;
  }
  pickerEl = createPicker();
  positionPicker(anchorBtn);

  // Dismiss on outside click
  const dismiss = (e) => {
    if (!pickerEl.contains(e.target) && e.target !== anchorBtn) {
      closePicker();
      document.removeEventListener('pointerdown', dismiss, true);
    }
  };
  // Defer so the click that opened the picker doesn't immediately close it
  setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
}

function positionPicker(anchor) {
  if (!pickerEl) return;
  const rect = anchor.getBoundingClientRect();
  pickerEl.style.position = 'fixed';
  pickerEl.style.zIndex = '9999';
  // Try to place above the anchor, fall back to below
  const pickerH = 320;
  if (rect.top - pickerH > 8) {
    pickerEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    pickerEl.style.top = 'auto';
  } else {
    pickerEl.style.top = (rect.bottom + 4) + 'px';
    pickerEl.style.bottom = 'auto';
  }
  pickerEl.style.left = Math.max(4, rect.left) + 'px';
}

function closePicker() {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}
