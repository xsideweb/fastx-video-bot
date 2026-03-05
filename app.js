/**
 * Xside AI — Telegram Mini App
 * Генерация видео: Image→Video, Motion Control, Kling 3.0
 */

(function () {
  'use strict';

  const Telegram = window.Telegram?.WebApp;
  if (Telegram) { Telegram.ready(); Telegram.expand(); }

  // ——— Early declarations to avoid TDZ ———
  let currentLang  = 'ru';
  let currentModel = 'kling-img2vid';

  // ——— State ———
  let credits = 450;
  const recent  = [];
  const gallery = [];
  let favoritePrompts = [];

  // ——— Model config ———
  const MODEL_CONFIG = {
    'kling-img2vid': {
      maxImages: 1, requiresImage: true, requiresVideo: false,
      getCost() { return $('#select-duration')?.value === '10' ? 50 : 30; },
    },
    'kling-motion': {
      maxImages: 1, requiresImage: true, requiresVideo: true,
      getCost() { return $('#select-motion-mode')?.value === '1080p' ? 60 : 40; },
    },
    'kling-video': {
      maxImages: 2, requiresImage: false, requiresVideo: false,
      getCost() { return $('#select-video-quality')?.value === 'pro' ? 80 : 50; },
    },
  };

  function getCurrentCost() { return MODEL_CONFIG[currentModel]?.getCost() ?? 30; }

  // ——— Helpers ———
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const API_BASE = (typeof window !== 'undefined' && (window.__APP_CONFIG__?.apiBase || document.documentElement.dataset?.apiBase)) || '';
  const isLocalFile = typeof location !== 'undefined' && (location.protocol === 'file:' || location.origin === 'null');
  const apiUrl = (p) => (API_BASE || (isLocalFile ? 'http://localhost:3000' : location.origin)).replace(/\/$/, '') + p;

  // ——— DOM refs ———
  const screenCreate   = $('#screen-create');
  const screenGallery  = $('#screen-gallery');
  const screenProfile  = $('#screen-profile');
  const profileNickname = $('#profile-nickname');
  const profileCredits  = $('#profile-credits');
  const profileGenerationsHint = $('#profile-generations-hint');
  const profileFavoritesList   = $('#profile-favorites-list');
  const profileFavoritesEmpty  = $('#profile-favorites-empty');
  const promptInput   = $('#prompt-input');
  const btnGenerate   = $('#btn-generate');
  const progressWrap  = $('#progress-wrap');
  const progressFill  = $('#progress-fill');
  const progressText  = $('#progress-text');
  const recentGrid    = $('#recent-grid');
  const galleryGrid   = $('#gallery-grid');
  const galleryEmpty  = $('#gallery-empty');
  const viewAll       = $('#view-all');
  const previewOverlay = $('#preview-overlay');
  const previewImage   = $('#preview-image');
  const previewVideo   = $('#preview-video');
  const previewClose   = $('.preview-close', previewOverlay);
  const previewBackdrop = $('.preview-backdrop', previewOverlay);
  const btnPreviewPrompt = $('#btn-preview-prompt');
  const btnPreviewFavoriteOnImage = $('#btn-preview-favorite-on-image');
  const btnPreviewCopyOnImage     = $('#btn-preview-copy-on-image');
  const previewImageButtons  = $('#preview-image-buttons');
  const previewPromptPopover = $('#preview-prompt-popover');
  const btnShare  = $('#btn-share');
  const btnExport = $('#btn-export');
  const creditsEl = $('#credits');
  const langToggle  = $('#lang-toggle');
  const menuOverlay = $('#menu-overlay');
  const menuNickname  = $('#menu-nickname');
  const menuCreditsEl = $('#menu-credits');
  const menuBackdrop  = $('.menu-backdrop', menuOverlay);
  const menuBtnTopup  = $('#menu-btn-topup');
  const menuBtn       = $('.menu-btn');
  const menuBtnIcon   = $('#menu-btn-icon');
  const imagesFileInput  = $('#images-file-input');
  const imagesThumbs     = $('#images-thumbs');
  const imagesCounter    = $('#images-counter');
  const imagesUploadArea = $('#images-upload-area');
  const videoFileInput   = $('#video-file-input');
  const videoThumbs      = $('#video-thumbs');
  const videoUploadArea  = $('#video-upload-area');
  const modelButtons     = $$('.model-option');
  const generateCostValueEl = $('#generate-cost-value');

  // ——— Uploads: reference images ———
  const MAX_SIZE_BYTES = 10 * 1024 * 1024;
  const ACCEPT_IMAGE_TYPES = ['image/jpeg', 'image/png'];
  const uploadedImages = [];

  function getMaxImages() { return MODEL_CONFIG[currentModel]?.maxImages ?? 1; }
  function isAcceptedImage(f) { return ACCEPT_IMAGE_TYPES.includes(f.type) && f.size <= MAX_SIZE_BYTES; }

  function addUploadedFiles(files) {
    const max = getMaxImages(), remaining = max - uploadedImages.length;
    let added = 0;
    for (const file of files) {
      if (added >= remaining) break;
      if (!isAcceptedImage(file)) continue;
      const id = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      uploadedImages.push({ id, file, dataUrl: null });
      added++;
      const reader = new FileReader();
      reader.onload = () => {
        const item = uploadedImages.find((u) => u.id === id);
        if (item) item.dataUrl = reader.result;
        const wrap = imagesThumbs?.querySelector('[data-upload-id="' + id + '"]');
        if (wrap) { const img = wrap.querySelector('img'); if (img) img.src = reader.result; }
        else renderUploads();
      };
      reader.readAsDataURL(file);
    }
    if (added > 0) renderUploads();
  }

  function removeUpload(id) {
    const i = uploadedImages.findIndex((u) => u.id === id);
    if (i !== -1) uploadedImages.splice(i, 1);
    renderUploads();
  }

  function renderUploads() {
    if (!imagesThumbs || !imagesCounter || !imagesUploadArea) return;
    imagesThumbs.innerHTML = '';
    const max = getMaxImages(), count = uploadedImages.length;
    imagesCounter.textContent = count + '/' + max;
    uploadedImages.forEach((item) => {
      const wrap = document.createElement('div');
      wrap.className = 'images-thumb-wrap';
      wrap.dataset.uploadId = item.id;
      const img = document.createElement('img'); img.src = item.dataUrl || ''; img.alt = '';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'images-thumb-remove'; btn.innerHTML = '×';
      btn.setAttribute('aria-label', 'Удалить');
      btn.addEventListener('click', (e) => { e.stopPropagation(); removeUpload(item.id); });
      wrap.appendChild(img); wrap.appendChild(btn);
      imagesThumbs.appendChild(wrap);
    });
    if (count < max) {
      const addCell = document.createElement('div');
      addCell.className = 'images-add-cell';
      addCell.innerHTML = '<span class="images-drop-plus">+</span><span class="images-drop-label">' + (currentLang === 'en' ? 'Add' : 'Добавить') + '</span>';
      addCell.addEventListener('click', () => imagesFileInput?.click());
      imagesThumbs.appendChild(addCell);
    }
    imagesThumbs.classList.toggle('images-thumbs--empty', count === 0);
    updateGenerateCost();
  }

  // ——— Uploads: reference video ———
  let uploadedRefVideo = null;

  function setUploadedVideo(file) {
    uploadedRefVideo = file ? { id: 'vid-' + Date.now(), file } : null;
    renderVideoUpload();
    updateGenerateCost();
  }

  function renderVideoUpload() {
    if (!videoThumbs) return;
    videoThumbs.innerHTML = '';
    if (uploadedRefVideo) {
      const wrap = document.createElement('div');
      wrap.className = 'images-thumb-wrap video-ref-thumb';
      const icon = document.createElement('div'); icon.className = 'video-ref-icon'; icon.textContent = '▶';
      const name = document.createElement('div'); name.className = 'video-ref-name';
      name.textContent = (uploadedRefVideo.file?.name || 'video.mp4').slice(0, 24);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'images-thumb-remove'; btn.innerHTML = '×';
      btn.addEventListener('click', (e) => { e.stopPropagation(); setUploadedVideo(null); });
      wrap.appendChild(icon); wrap.appendChild(name); wrap.appendChild(btn);
      videoThumbs.appendChild(wrap);
    } else {
      const addCell = document.createElement('div');
      addCell.className = 'images-add-cell';
      addCell.innerHTML = '<span class="images-drop-plus">+</span><span class="images-drop-label">' + (currentLang === 'en' ? 'Add video' : 'Добавить видео') + '</span>';
      addCell.addEventListener('click', () => videoFileInput?.click());
      videoThumbs.appendChild(addCell);
    }
  }

  // ——— File input listeners ———
  if (imagesFileInput) {
    imagesFileInput.addEventListener('change', (e) => { addUploadedFiles(e.target.files ? [...e.target.files] : []); e.target.value = ''; });
  }
  if (imagesUploadArea) {
    imagesUploadArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); imagesUploadArea.classList.add('drag-over'); });
    imagesUploadArea.addEventListener('dragleave', (e) => { if (!imagesUploadArea.contains(e.relatedTarget)) imagesUploadArea.classList.remove('drag-over'); });
    imagesUploadArea.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); imagesUploadArea.classList.remove('drag-over');
      addUploadedFiles([...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/')));
    });
  }
  if (videoFileInput) {
    videoFileInput.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) setUploadedVideo(f); e.target.value = ''; });
  }
  if (videoUploadArea) {
    videoUploadArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); videoUploadArea.classList.add('drag-over'); });
    videoUploadArea.addEventListener('dragleave', (e) => { if (!videoUploadArea.contains(e.relatedTarget)) videoUploadArea.classList.remove('drag-over'); });
    videoUploadArea.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); videoUploadArea.classList.remove('drag-over');
      const f = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('video/'));
      if (f) setUploadedVideo(f);
    });
  }

  // ——— Model switch & options visibility ———
  function updateOptionsVisibility() {
    const isImgVid = currentModel === 'kling-img2vid';
    const isMotion = currentModel === 'kling-motion';
    const isKling3 = currentModel === 'kling-video';
    $('#duration-wrap')?.classList.toggle('hidden', !isImgVid && !isKling3);
    $('#sound-wrap')?.classList.toggle('hidden', !isImgVid && !isKling3);
    $('#motion-mode-wrap')?.classList.toggle('hidden', !isMotion);
    $('#orientation-wrap')?.classList.toggle('hidden', !isMotion);
    $('#video-quality-wrap')?.classList.toggle('hidden', !isKling3);
    $('#video-aspect-wrap')?.classList.toggle('hidden', !isKling3);
    $('#video-upload-section')?.classList.toggle('hidden', !isMotion);
    const titleEl = $('#images-upload-title'), rulesEl = $('#images-upload-rules');
    if (titleEl) {
      titleEl.textContent = isMotion ? (currentLang === 'en' ? 'CHARACTER IMAGE' : 'ИЗОБРАЖЕНИЕ ПЕРСОНАЖА')
        : isKling3 ? (currentLang === 'en' ? 'IMAGES (OPTIONAL)' : 'ИЗОБРАЖЕНИЯ (НЕОБЯЗАТЕЛЬНО)')
        : (currentLang === 'en' ? 'REFERENCE IMAGE' : 'ОПОРНОЕ ИЗОБРАЖЕНИЕ');
    }
    if (rulesEl) rulesEl.textContent = isKling3 ? (currentLang === 'en' ? 'up to 2 JPG/PNG • ≤ 10 MB' : 'до 2 шт. JPG/PNG • ≤ 10 МБ') : 'JPG/PNG • ≤ 10 МБ';
    const max = MODEL_CONFIG[currentModel]?.maxImages ?? 1;
    while (uploadedImages.length > max) uploadedImages.pop();
    renderUploads();
    renderVideoUpload();
  }

  if (modelButtons.length) {
    const activeBtn = modelButtons.find((b) => b.classList.contains('model-option-active'));
    if (activeBtn?.dataset?.model) currentModel = activeBtn.dataset.model;
    modelButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        modelButtons.forEach((b) => b.classList.remove('model-option-active'));
        btn.classList.add('model-option-active');
        if (btn.dataset?.model) currentModel = btn.dataset.model;
        updateOptionsVisibility();
        updateGenerateCost();
      });
    });
  }
  updateOptionsVisibility();

  ['select-duration','select-sound','select-motion-mode','select-orientation','select-video-quality','select-video-aspect'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', updateGenerateCost);
  });

  function updateGenerateCost() {
    if (generateCostValueEl) generateCostValueEl.textContent = String(getCurrentCost());
  }

  // ——— Nickname / credits ———
  function getNickname() {
    const user = Telegram?.initDataUnsafe?.user;
    if (!user) return currentLang === 'en' ? 'User' : 'Пользователь';
    return user.username ? '@' + user.username : (user.first_name || (currentLang === 'en' ? 'User' : 'Пользователь'));
  }

  function renderCredits() {
    if (creditsEl) creditsEl.textContent = String(credits);
    if (menuCreditsEl) menuCreditsEl.textContent = String(credits);
    if (screenProfile?.classList.contains('active')) renderProfile();
  }

  // ——— Menu ———
  function openMenu() {
    if (!menuOverlay) return;
    if (menuNickname) menuNickname.textContent = getNickname();
    if (menuCreditsEl) menuCreditsEl.textContent = String(credits);
    menuOverlay.classList.remove('hidden'); menuOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (menuBtnIcon) menuBtnIcon.src = 'icons/close.svg';
  }
  function closeMenu() {
    if (!menuOverlay) return;
    menuOverlay.classList.add('hidden'); menuOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (menuBtnIcon) menuBtnIcon.src = 'icons/hamburger-menu.svg';
  }
  function toggleMenu() { menuOverlay && !menuOverlay.classList.contains('hidden') ? closeMenu() : openMenu(); }
  if (menuBtn) menuBtn.addEventListener('click', toggleMenu);
  if (menuBackdrop) menuBackdrop.addEventListener('click', closeMenu);
  if (menuBtnTopup) menuBtnTopup.addEventListener('click', () => { closeMenu(); showScreen('profile'); });

  // ——— Gallery grid item ———
  function createGridItem(item) {
    const div = document.createElement('div');
    div.className = 'grid-item';
    div.dataset.id = item?.id || '';
    const isVideo = item?.mediaType === 'video' || !item?.mediaType;
    if (isVideo) {
      div.classList.add('grid-item-video');
      const bg = document.createElement('div'); bg.className = 'video-thumb-bg';
      const play = document.createElement('div'); play.className = 'video-thumb-play-icon'; play.innerHTML = '&#9654;';
      bg.appendChild(play); div.appendChild(bg);
    } else {
      const img = document.createElement('img');
      img.src = apiUrl('/api/thumb?url=' + encodeURIComponent(item.url));
      img.alt = item.prompt || ''; img.loading = 'lazy';
      div.appendChild(img);
    }
    return div;
  }

  function renderRecentGrid() {
    if (!recentGrid) return;
    recentGrid.innerHTML = '';
    if (recent.length === 0) {
      const p = document.createElement('p'); p.className = 'recent-empty';
      p.textContent = currentLang === 'en' ? 'No videos yet' : 'пока видео нет';
      recentGrid.appendChild(p); return;
    }
    recent.slice(0, 6).forEach((item) => { const el = createGridItem(item); el.addEventListener('click', () => openPreview(item)); recentGrid.appendChild(el); });
  }

  function renderGalleryGrid() {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';
    if (gallery.length === 0) { if (galleryEmpty) galleryEmpty.classList.remove('hidden'); return; }
    if (galleryEmpty) galleryEmpty.classList.add('hidden');
    gallery.forEach((item) => {
      const el = createGridItem(item);
      if (item?.id) el.style.viewTransitionName = 'gallery-item-' + item.id;
      el.addEventListener('click', () => openPreview(item));
      if (item?.id) {
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'images-thumb-remove gallery-item-remove';
        rm.setAttribute('aria-label', 'Удалить из галереи'); rm.dataset.galleryId = item.id;
        rm.innerHTML = '<span aria-hidden="true">×</span>'; el.appendChild(rm);
      }
      galleryGrid.appendChild(el);
    });
  }

  async function deleteGalleryItem(itemId, cardEl) {
    try {
      const ok = await confirmDelete(currentLang === 'en' ? 'Delete this video from gallery?' : 'Удалить это видео из галереи?');
      if (!ok) return;
      const userId = getUserId(); if (userId == null) return;
      const r = await fetch(apiUrl('/api/gallery'), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: String(userId), id: itemId }) });
      if (!r.ok) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Не удалось удалить' }); return; }
      const doRemove = () => {
        const idx = gallery.findIndex((g) => g.id === itemId); if (idx !== -1) gallery.splice(idx, 1);
        const ri = recent.findIndex((g) => g.id === itemId); if (ri !== -1) recent.splice(ri, 1);
        if (cardEl?.isConnected) { try { cardEl.remove(); } catch { renderGalleryGrid(); } } else renderGalleryGrid();
        if (gallery.length === 0 && galleryEmpty) galleryEmpty.classList.remove('hidden');
        renderRecentGrid();
      };
      if (cardEl?.isConnected) { cardEl.classList.add('gallery-item-removing'); setTimeout(doRemove, 280); } else doRemove();
    } catch { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Нет связи с сервером' }); }
  }

  if (galleryGrid) {
    galleryGrid.addEventListener('click', (e) => {
      const btn = (e.target?.nodeType === 1 ? e.target : e.target?.parentElement)?.closest?.('.gallery-item-remove');
      if (!btn || !btn.dataset.galleryId) return;
      e.preventDefault(); e.stopPropagation();
      deleteGalleryItem(btn.dataset.galleryId, btn.closest('.grid-item'));
    }, true);
  }

  // ——— Preview ———
  let currentPreviewItem = null;

  function openPreview(item) {
    if (!item?.url || !previewOverlay) return;
    currentPreviewItem = item;
    const isVideo = item.mediaType === 'video' || !item.mediaType;
    if (previewPromptPopover) { previewPromptPopover.classList.add('hidden'); previewPromptPopover.textContent = ''; }
    if (previewImageButtons) previewImageButtons.classList.add('hidden');
    if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.style.backgroundColor = '';
    if (isVideo) {
      if (previewImage) { previewImage.classList.add('hidden'); previewImage.src = ''; }
      if (previewVideo) { previewVideo.classList.remove('hidden'); previewVideo.src = item.url; previewVideo.load(); }
    } else {
      if (previewVideo) { previewVideo.classList.add('hidden'); previewVideo.pause(); previewVideo.src = ''; }
      if (previewImage) { previewImage.classList.remove('hidden'); previewImage.src = ''; previewImage.alt = item.prompt || ''; previewImage.src = apiUrl('/api/view?url=' + encodeURIComponent(item.url) + '&w=724&h=724'); }
    }
    previewOverlay.classList.remove('hidden'); document.body.style.overflow = 'hidden';
    loadFavoritePrompts();
  }

  function closePreview() {
    if (previewVideo) { previewVideo.pause(); previewVideo.src = ''; }
    if (previewOverlay) { previewOverlay.classList.add('hidden'); document.body.style.overflow = ''; }
    if (previewPromptPopover) { previewPromptPopover.classList.add('hidden'); previewPromptPopover.textContent = ''; }
    if (btnPreviewPrompt) btnPreviewPrompt.textContent = currentLang === 'en' ? 'Show prompt' : 'Показать промпт';
    if (previewImageButtons) previewImageButtons.classList.add('hidden');
  }

  function updateFavoriteButtonStyle() {
    if (!btnPreviewFavoriteOnImage) return;
    btnPreviewFavoriteOnImage.style.backgroundColor = (currentPreviewItem && favoritePrompts.includes(currentPreviewItem.prompt)) ? 'var(--accent-mid)' : '';
  }

  function togglePromptPopover() {
    if (!previewPromptPopover || !currentPreviewItem || !btnPreviewPrompt) return;
    const hidden = previewPromptPopover.classList.contains('hidden');
    if (hidden) {
      previewPromptPopover.textContent = currentPreviewItem.prompt || (currentLang === 'en' ? 'No prompt' : 'Промпт не указан');
      previewPromptPopover.classList.remove('hidden');
      btnPreviewPrompt.textContent = currentLang === 'en' ? 'Hide prompt' : 'Спрятать промпт';
      if (previewImageButtons) previewImageButtons.classList.remove('hidden');
      updateFavoriteButtonStyle();
    } else {
      previewPromptPopover.classList.add('hidden'); previewPromptPopover.textContent = '';
      btnPreviewPrompt.textContent = currentLang === 'en' ? 'Show prompt' : 'Показать промпт';
      if (previewImageButtons) previewImageButtons.classList.add('hidden');
      if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.style.backgroundColor = '';
    }
  }

  let copyFeedbackTimeout = null;
  function copyPromptToClipboard() {
    if (!currentPreviewItem?.prompt) return;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(currentPreviewItem.prompt).catch(() => {});
    if (btnPreviewCopyOnImage) {
      if (copyFeedbackTimeout) clearTimeout(copyFeedbackTimeout);
      const img = btnPreviewCopyOnImage.querySelector('.icon, img');
      if (img) img.src = 'icons/check-circle.svg';
      btnPreviewCopyOnImage.style.backgroundColor = '#ff9500';
      copyFeedbackTimeout = setTimeout(() => { if (img) img.src = 'icons/copy.svg'; btnPreviewCopyOnImage.style.backgroundColor = ''; copyFeedbackTimeout = null; }, 3000);
    }
  }

  if (previewImage)  previewImage.addEventListener('click', (e) => e.stopPropagation());
  if (btnPreviewPrompt) btnPreviewPrompt.addEventListener('click', (e) => { e.stopPropagation(); togglePromptPopover(); });
  if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentPreviewItem?.prompt) addFavoritePrompt(currentPreviewItem.prompt).then(() => { updateFavoriteButtonStyle(); if (screenProfile?.classList.contains('active')) renderProfileFavorites(); });
  });
  if (btnPreviewCopyOnImage) btnPreviewCopyOnImage.addEventListener('click', (e) => { e.stopPropagation(); copyPromptToClipboard(); });
  if (previewClose)    previewClose.addEventListener('click', closePreview);
  if (previewBackdrop) previewBackdrop.addEventListener('click', closePreview);

  // ——— Export / Share ———
  function exportMedia() {
    const url = currentPreviewItem?.url || previewVideo?.src || previewImage?.src;
    if (!url) return;
    const isVid = currentPreviewItem?.mediaType === 'video' || !currentPreviewItem?.mediaType;
    const ext = isVid ? 'mp4' : (url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || 'mp4');
    const filename = 'xside-video-' + Date.now() + '.' + ext;
    if (Telegram?.downloadFile && !url.startsWith('blob:')) {
      const dlUrl = apiUrl('/api/download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent(filename));
      Telegram.downloadFile({ url: dlUrl, file_name: filename }, (ok) => {
        if (Telegram?.showPopup) Telegram.showPopup({ title: currentLang === 'en' ? 'Download' : 'Скачать', message: ok ? (currentLang === 'en' ? 'Saved' : 'Сохранено') : (currentLang === 'en' ? 'Cancelled' : 'Отменено') });
      });
      return;
    }
    const a = document.createElement('a'); a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function shareMedia() {
    const url = currentPreviewItem?.url;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Поделиться', message: 'Сначала скачайте видео' }); return; }
    const link = 'https://t.me/share/url?url=' + encodeURIComponent(apiUrl('/api/view?url=' + encodeURIComponent(url))) + '&text=' + encodeURIComponent('\nПереслано из FastX Video Generator');
    if (Telegram?.openTelegramLink) Telegram.openTelegramLink(link); else window.open(link, '_blank');
  }

  if (btnShare)  btnShare.addEventListener('click', shareMedia);
  if (btnExport) btnExport.addEventListener('click', exportMedia);

  // ——— Screens ———
  function showScreen(name) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
    if (name === 'create'  && screenCreate)  screenCreate.classList.add('active');
    if (name === 'gallery' && screenGallery) { screenGallery.classList.add('active'); renderGalleryGrid(); }
    if (name === 'profile' && screenProfile) { screenProfile.classList.add('active'); loadCreditsFromApi().catch(() => {}); loadFavoritePrompts().then(() => renderProfile()); }
  }
  $$('.nav-item').forEach((btn) => { if (!btn.disabled) btn.addEventListener('click', () => showScreen(btn.dataset.screen)); });
  if (viewAll) viewAll.addEventListener('click', () => showScreen('gallery'));

  // ——— Profile ———
  function renderProfileFavorites() {
    if (!profileFavoritesList || !profileFavoritesEmpty) return;
    profileFavoritesList.innerHTML = '';
    if (!favoritePrompts.length) { profileFavoritesEmpty.classList.remove('hidden'); return; }
    profileFavoritesEmpty.classList.add('hidden');
    favoritePrompts.forEach((prompt) => {
      const chip = document.createElement('div'); chip.className = 'profile-favorite-chip';
      const text = document.createElement('span'); text.className = 'profile-favorite-chip-text';
      text.textContent = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt; text.title = prompt;
      const actions = document.createElement('span'); actions.className = 'profile-favorite-chip-actions';
      const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'profile-favorite-chip-btn'; copyBtn.setAttribute('aria-label', 'Копировать');
      const copyIcon = document.createElement('img'); copyIcon.src = 'icons/copy.svg'; copyIcon.alt = ''; copyIcon.className = 'icon'; copyBtn.appendChild(copyIcon);
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(prompt).catch(() => {}); copyIcon.src = 'icons/check-circle.svg'; setTimeout(() => { copyIcon.src = 'icons/copy.svg'; }, 3000); } });
      const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'profile-favorite-chip-btn'; rmBtn.setAttribute('aria-label', 'Удалить'); rmBtn.innerHTML = '×';
      rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFavoritePrompt(prompt).then(() => renderProfileFavorites()); });
      actions.appendChild(copyBtn); actions.appendChild(rmBtn); chip.appendChild(text); chip.appendChild(actions);
      profileFavoritesList.appendChild(chip);
    });
  }

  function renderProfile() {
    if (profileNickname) profileNickname.textContent = getNickname();
    if (profileCredits)  profileCredits.textContent  = String(credits);
    const gens = Math.floor(credits / 30);
    if (profileGenerationsHint) profileGenerationsHint.textContent = currentLang === 'en' ? `(≈ ${gens} videos)` : `(≈ ${gens} видео)`;
    renderProfileFavorites();
  }

  // ——— Topup packs ———
  const TOPUP_PACKS = [
    { id: '25',  stars: 25,  credits: 50,  priceRub: 49  },
    { id: '50',  stars: 50,  credits: 100, priceRub: 95  },
    { id: '100', stars: 100, credits: 210, priceRub: 179 },
    { id: '250', stars: 250, credits: 530, priceRub: 429 },
  ];

  const profileBtnTopupStars = $('#profile-btn-topup-stars');
  const topupPacksOverlay  = $('#topup-packs-overlay');
  const topupPacksList     = $('#topup-packs-list');
  const topupPacksBackdrop = $('.topup-packs-backdrop', topupPacksOverlay);
  const topupPacksClose    = $('.topup-packs-close', topupPacksOverlay);

  function renderTopupButtons(container) {
    if (!container || !TOPUP_PACKS.length) return;
    container.innerHTML = TOPUP_PACKS.map((p) => {
      const base = p.stars === 25 ? 50 : p.stars === 50 ? 100 : p.stars === 100 ? 200 : 500;
      const bonus = p.credits > base ? p.credits - base : 0;
      const eco   = bonus && base ? Math.round((bonus / base) * 100) : 0;
      return '<button type="button" class="topup-pack-btn neumorph-btn gradient-premium" data-pack-id="' + p.id + '">' +
        (eco ? '<span class="topup-pack-badge">Экономия ' + eco + '%</span>' : '') +
        '<span class="topup-pack-main"><span class="topup-pack-stars"><img src="icons/star.svg" alt="" class="icon icon-btn-sm"> ' + p.stars + ' Stars</span> <span class="topup-pack-coins">(' + base + ' монет' + (bonus ? ' <span class="topup-pack-bonus">+' + bonus + ' бонус</span>' : '') + ')</span></span>' +
        '<span class="topup-pack-rub">≈ ' + p.priceRub + ' руб</span></button>';
    }).join('');
    container.querySelectorAll('.topup-pack-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = getUserId();
        if (uid == null) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Войдите в аккаунт Telegram' }); return; }
        buyPack(uid, btn.dataset.packId);
      });
    });
  }

  function openTopupPacksModal() {
    if (getUserId() == null) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Войдите в аккаунт Telegram' }); return; }
    renderTopupButtons(topupPacksList);
    if (topupPacksOverlay) { topupPacksOverlay.classList.remove('hidden'); topupPacksOverlay.setAttribute('aria-hidden', 'false'); }
  }

  async function buyPack(userId, packId) {
    try {
      const r = await fetch(apiUrl('/api/invoice-link'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: String(userId), pack: String(packId) }) });
      if (!r.ok) { const err = await r.json().catch(() => ({})); if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: err.error || 'Не удалось создать счёт' }); return; }
      const { invoiceUrl } = await r.json();
      if (topupPacksOverlay) { topupPacksOverlay.classList.add('hidden'); topupPacksOverlay.setAttribute('aria-hidden', 'true'); }
      if (invoiceUrl && Telegram?.openInvoice) Telegram.openInvoice(invoiceUrl);
      else if (invoiceUrl && Telegram?.openLink) Telegram.openLink(invoiceUrl);
    } catch { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Нет связи с сервером' }); }
  }

  function closeTopupPacksModal() { if (topupPacksOverlay) { topupPacksOverlay.classList.add('hidden'); topupPacksOverlay.setAttribute('aria-hidden', 'true'); } }

  if (profileBtnTopupStars) profileBtnTopupStars.addEventListener('click', openTopupPacksModal);
  if (topupPacksBackdrop)   topupPacksBackdrop.addEventListener('click', closeTopupPacksModal);
  if (topupPacksClose)      topupPacksClose.addEventListener('click', closeTopupPacksModal);

  [$('#profile-btn-test-2'), $('#profile-btn-test-3')].forEach((btn, i) => {
    if (btn) btn.addEventListener('click', () => { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Тест', message: 'Нажата тестовая кнопка ' + (i + 2) }); });
  });

  // ——— Progress ———
  let progressIntervalId = null;
  function setProgress(visible, text, percent) {
    if (progressIntervalId != null) { clearInterval(progressIntervalId); progressIntervalId = null; }
    if (progressWrap) progressWrap.classList.toggle('hidden', !visible);
    if (progressFill) progressFill.style.width = visible ? (typeof percent === 'number' ? percent + '%' : '0%') : '0%';
    if (progressText) progressText.textContent = text || (currentLang === 'en' ? 'Generating...' : 'Генерация видео...');
  }
  function startProgressSimulation() {
    let p = 10;
    progressIntervalId = setInterval(() => {
      p = Math.min(p + 2, 85);
      if (progressFill) progressFill.style.width = p + '%';
      if (p >= 85 && progressIntervalId) { clearInterval(progressIntervalId); progressIntervalId = null; }
    }, 3000);
  }

  // ——— User ID ———
  function getUserId() { return Telegram?.initDataUnsafe?.user?.id; }

  async function loadCreditsFromApi() {
    const uid = getUserId(); if (uid == null) return;
    try {
      const r = await fetch(apiUrl('/api/credits?userId=' + encodeURIComponent(String(uid))));
      if (!r.ok) return;
      const data = await r.json();
      if (typeof data.credits === 'number') {
        credits = Math.max(0, data.credits); renderCredits();
        if (profileCredits) profileCredits.textContent = String(credits);
        if (profileGenerationsHint) profileGenerationsHint.textContent = '(≈ ' + Math.floor(credits / 30) + ' видео)';
      }
    } catch { /* ignore */ }
  }

  // ——— Favorites API ———
  async function loadFavoritePrompts() {
    const uid = getUserId(); if (uid == null) { favoritePrompts = []; return; }
    try { const r = await fetch(apiUrl('/api/favorites?userId=' + encodeURIComponent(String(uid)))); favoritePrompts = r.ok ? (await r.json().catch(() => [])) : []; if (!Array.isArray(favoritePrompts)) favoritePrompts = []; }
    catch { favoritePrompts = []; }
  }
  async function addFavoritePrompt(text) {
    const t = (text || '').trim(); const uid = getUserId(); if (!t || uid == null) return;
    try { const r = await fetch(apiUrl('/api/favorites'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: String(uid), prompt: t }) }); if (r.ok) await loadFavoritePrompts(); }
    catch { /* ignore */ }
  }
  async function removeFavoritePrompt(text) {
    const uid = getUserId(); if (uid == null) return;
    try { const r = await fetch(apiUrl('/api/favorites'), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: String(uid), prompt: String(text) }) }); if (r.ok) await loadFavoritePrompts(); }
    catch { /* ignore */ }
  }

  // ——— Confirm dialog ———
  const confirmOverlay = document.createElement('div');
  confirmOverlay.className = 'confirm-overlay hidden';
  confirmOverlay.innerHTML = '<div class="confirm-backdrop"></div><div class="confirm-panel"><p class="confirm-message"></p><div class="confirm-buttons"><button type="button" class="confirm-btn confirm-btn-cancel neumorph-btn">Отмена</button><button type="button" class="confirm-btn confirm-btn-ok neumorph-btn gradient-premium">Удалить</button></div></div>';
  document.body.appendChild(confirmOverlay);
  const confirmMsgEl = confirmOverlay.querySelector('.confirm-message');
  const confirmOkBtn = confirmOverlay.querySelector('.confirm-btn-ok');
  const confirmCancelBtn = confirmOverlay.querySelector('.confirm-btn-cancel');
  const confirmBackdrop  = confirmOverlay.querySelector('.confirm-backdrop');

  function confirmDelete(message) {
    return new Promise((resolve) => {
      if (confirmMsgEl) confirmMsgEl.textContent = message;
      confirmOverlay.classList.remove('hidden');
      function cleanup(result) { confirmOverlay.classList.add('hidden'); confirmOkBtn.removeEventListener('click', onOk); confirmCancelBtn.removeEventListener('click', onCancel); confirmBackdrop.removeEventListener('click', onCancel); resolve(result); }
      function onOk() { cleanup(true); } function onCancel() { cleanup(false); }
      confirmOkBtn.addEventListener('click', onOk); confirmCancelBtn.addEventListener('click', onCancel); confirmBackdrop.addEventListener('click', onCancel);
    });
  }

  // ——— Language ———
  const LANG_STORAGE_KEY = 'xside-lang';
  function getInitialLang() {
    try { if (typeof localStorage !== 'undefined') { const s = localStorage.getItem(LANG_STORAGE_KEY); if (s === 'ru' || s === 'en') return s; } } catch { /* ignore */ }
    return String(Telegram?.initDataUnsafe?.user?.language_code || navigator.language || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  }
  // Assign proper lang (declared at top of IIFE)
  currentLang = getInitialLang();

  function applyLanguage() {
    const isEn = currentLang === 'en';
    if (document.documentElement) document.documentElement.lang = isEn ? 'en' : 'ru';
    if (langToggle) { langToggle.textContent = isEn ? 'EN' : 'RU'; langToggle.setAttribute('aria-label', isEn ? 'Language' : 'Язык'); }
    if (promptInput) promptInput.placeholder = isEn ? 'Describe the video (e.g. A cat jumping over a rainbow)' : 'Опишите видео (например: Кот скачет по радуге в киберпанк-городе)';

    const labels = { 'duration-wrap': isEn ? 'Duration' : 'Длительность', 'sound-wrap': isEn ? 'Sound' : 'Звук', 'motion-mode-wrap': isEn ? 'Resolution' : 'Разрешение', 'orientation-wrap': isEn ? 'Orientation' : 'Ориентация', 'video-quality-wrap': isEn ? 'Quality' : 'Качество', 'video-aspect-wrap': isEn ? 'Aspect' : 'Формат' };
    Object.entries(labels).forEach(([id, text]) => { const el = document.querySelector('#' + id + ' .select-label-text'); if (el) el.textContent = text; });

    // Translate select options
    const dur = $('#select-duration'); if (dur) { if (dur.options[0]) dur.options[0].textContent = isEn ? '5 sec' : '5 сек'; if (dur.options[1]) dur.options[1].textContent = isEn ? '10 sec' : '10 сек'; }
    const snd = $('#select-sound'); if (snd) { if (snd.options[0]) snd.options[0].textContent = isEn ? 'No sound' : 'Без звука'; if (snd.options[1]) snd.options[1].textContent = isEn ? 'With sound' : 'Со звуком'; }
    const ori = $('#select-orientation'); if (ori) { if (ori.options[0]) ori.options[0].textContent = isEn ? 'Follow video' : 'По видео'; if (ori.options[1]) ori.options[1].textContent = isEn ? 'Follow image' : 'По картинке'; }
    const vq = $('#select-video-quality'); if (vq) { if (vq.options[0]) vq.options[0].textContent = isEn ? 'Standard' : 'Стандарт'; if (vq.options[1]) vq.options[1].textContent = 'Pro HD'; }

    const gl = $('#btn-generate-label'); if (gl) gl.textContent = isEn ? 'Generate' : 'Сгенерировать';
    const recentEmpty = document.querySelector('.recent-empty'); if (recentEmpty) recentEmpty.textContent = isEn ? 'No videos yet' : 'пока видео нет';
    const rt = document.querySelector('.recent-title'); if (rt) rt.textContent = isEn ? 'Recent generations' : 'Последние генерации';
    const va = document.querySelector('#view-all'); if (va) va.textContent = isEn ? 'All' : 'Все';
    const gt = document.querySelector('.gallery-title'); if (gt) gt.textContent = isEn ? 'Gallery' : 'Галерея';
    if (galleryEmpty) galleryEmpty.textContent = isEn ? 'No videos yet. Create the first one on the "Create" tab.' : 'Пока нет видео. Создайте первое на вкладке «Создать».';
    const bt = document.querySelector('.balance-title'); if (bt) bt.textContent = isEn ? 'Current balance:' : 'Актуальный баланс:';
    const gens = Math.floor(credits / 30); if (profileGenerationsHint) profileGenerationsHint.textContent = isEn ? `(≈ ${gens} videos)` : `(≈ ${gens} видео)`;
    const pt = $('#profile-btn-test-2'); if (pt) pt.innerHTML = '<img src="icons/card.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Buy tokens' : 'Купить токены');
    const ps = $('#profile-btn-topup-stars'); if (ps) ps.innerHTML = '<img src="icons/star.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Top up with Stars' : 'Пополнение через Stars');
    const pc = $('#profile-btn-test-3'); if (pc) pc.innerHTML = '<img src="icons/bitcoin-circle.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Top up with crypto' : 'Пополнение через криптовалюту');
    const pkt = document.querySelector('.topup-packs-title'); if (pkt) pkt.textContent = isEn ? 'Buy coins' : 'Купить монеты';
    const fvt = document.querySelector('.profile-favorites-title'); if (fvt) fvt.textContent = isEn ? 'Favorite prompts' : 'Избранные промпты';
    if (profileFavoritesEmpty) profileFavoritesEmpty.textContent = isEn ? 'Add prompts from video preview (★).' : 'Добавляйте промпты из превью видео (★).';
    const mcl = document.querySelector('.menu-credits-line');
    if (mcl) { const sp = mcl.querySelector('#menu-credits'); if (sp) { const v = sp.textContent || '0'; mcl.innerHTML = '<img src="icons/banking-coin.svg" alt="" class="icon icon-credits-inline"><span id="menu-credits" class="menu-credits">' + v + '</span> ' + (isEn ? 'coins' : 'монет'); } }
    const mtu = document.querySelector('#menu-btn-topup'); if (mtu) mtu.textContent = isEn ? 'Buy tokens' : 'Купить токены';
    $$('.bottom-nav .nav-item').forEach((item) => { const lbl = item.querySelector('.nav-label'); if (!lbl) return; const s = item.dataset.screen; if (s === 'create') lbl.textContent = isEn ? 'Create' : 'Создать'; if (s === 'gallery') lbl.textContent = isEn ? 'Gallery' : 'Галерея'; if (s === 'profile') lbl.textContent = isEn ? 'Profile' : 'Профиль'; });
    const ppb = document.querySelector('#btn-preview-prompt'); if (ppb) { ppb.textContent = isEn ? 'Show prompt' : 'Показать промпт'; ppb.setAttribute('aria-label', isEn ? 'Show prompt' : 'Показать промпт'); }
    const bsh = document.querySelector('#btn-share'); if (bsh) bsh.innerHTML = '<img src="icons/share.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Share' : 'Поделиться');
    const bex = document.querySelector('#btn-export'); if (bex) bex.innerHTML = '<img src="icons/download-minimalistic.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Download' : 'Скачать');
    if (confirmOkBtn) confirmOkBtn.textContent = isEn ? 'Delete' : 'Удалить';
    if (confirmCancelBtn) confirmCancelBtn.textContent = isEn ? 'Cancel' : 'Отмена';
    updateOptionsVisibility();
  }

  function setLanguage(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    currentLang = lang;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* ignore */ }
    applyLanguage();
  }
  if (langToggle) langToggle.addEventListener('click', () => setLanguage(currentLang === 'en' ? 'ru' : 'en'));

  // ——— Insufficient credits popup ———
  function showInsufficientCreditsPopup(required) {
    const msg = currentLang === 'en' ? 'You need ' + required + ' tokens. Please top up your balance.' : 'Для генерации нужно ' + required + ' токенов. Пополните баланс.';
    if (window.Telegram?.WebApp?.showPopup) {
      window.Telegram.WebApp.showPopup({ title: currentLang === 'en' ? 'Not enough tokens' : 'Недостаточно токенов', message: msg, buttons: [{ id: 'close', type: 'close' }, { id: 'topup', type: 'default', text: currentLang === 'en' ? 'Top up' : 'Пополнить' }] }, (btnId) => { if (btnId === 'topup') showScreen('profile'); });
    } else { if (window.confirm?.(currentLang === 'en' ? 'Not enough tokens. Open profile?' : 'Недостаточно токенов. Открыть профиль?')) showScreen('profile'); }
  }

  function showError(message) {
    setProgress(false);
    if (progressIntervalId) { clearInterval(progressIntervalId); progressIntervalId = null; }
    if (btnGenerate) btnGenerate.disabled = false;
    const msg = message || (currentLang === 'en' ? 'Failed to generate video' : 'Не удалось сгенерировать видео');
    if (Telegram?.showPopup) Telegram.showPopup({ title: currentLang === 'en' ? 'Error' : 'Ошибка', message: msg });
    else if (typeof alert === 'function') alert(msg);
  }

  function resetForm() {
    if (promptInput) promptInput.value = '';
    uploadedImages.length = 0; setUploadedVideo(null); renderUploads();
    if (imagesFileInput) imagesFileInput.value = '';
  }

  function finishGenerate(resultUrl, galleryItem) {
    const item = galleryItem || { id: 'gen-' + Date.now(), url: resultUrl, prompt: (promptInput?.value || '').trim() || 'Видео', createdAt: Date.now(), mediaType: 'video' };
    if (item.url) { recent.unshift(item); gallery.unshift(item); }
    loadCreditsFromApi().then(() => renderCredits()).catch(() => renderCredits());
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = currentLang === 'en' ? 'Done!' : 'Готово!';
    setTimeout(() => { setProgress(false); if (btnGenerate) btnGenerate.disabled = false; renderRecentGrid(); renderGalleryGrid(); resetForm(); }, 600);
  }

  // ——— Main generation ———
  async function startGenerate() {
    const prompt = (promptInput?.value || '').trim();
    const isMotion = currentModel === 'kling-motion', isImgVid = currentModel === 'kling-img2vid', isKling3 = currentModel === 'kling-video';
    if (!isMotion && !prompt && !isKling3) { if (Telegram?.showPopup) Telegram.showPopup({ title: currentLang === 'en' ? 'Enter description' : 'Введите описание', message: currentLang === 'en' ? 'Write a prompt for generation' : 'Напишите промпт для генерации' }); return; }
    if (isKling3 && !prompt && uploadedImages.length === 0) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: currentLang === 'en' ? 'Enter a prompt or upload an image' : 'Введите промпт или загрузите изображение' }); return; }
    if ((isImgVid || isMotion) && uploadedImages.length === 0) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: currentLang === 'en' ? 'Upload a reference image' : 'Загрузите опорное изображение' }); return; }
    if (isMotion && !uploadedRefVideo) { if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: currentLang === 'en' ? 'Upload a reference video for Motion Control' : 'Загрузите референс видео для Motion Control' }); return; }

    const cost = getCurrentCost(), userId = getUserId();
    if (userId != null && credits < cost) { showInsufficientCreditsPopup(cost); return; }

    if (btnGenerate) btnGenerate.disabled = true;
    setProgress(true, currentLang === 'en' ? 'Sending...' : 'Отправка...', 0);

    const form = new FormData();
    form.append('model',        currentModel);
    form.append('prompt',       prompt);
    form.append('userId',       userId != null ? String(userId) : '');
    form.append('duration',     $('#select-duration')?.value    || '5');
    form.append('sound',        String($('#select-sound')?.value === 'true'));
    form.append('motionMode',   $('#select-motion-mode')?.value  || '720p');
    form.append('orientation',  $('#select-orientation')?.value  || 'video');
    form.append('videoQuality', $('#select-video-quality')?.value || 'std');
    form.append('videoAspect',  $('#select-video-aspect')?.value  || '16:9');
    uploadedImages.forEach((u) => { if (u.file) form.append('images', u.file); });
    if (uploadedRefVideo?.file) form.append('refvideo', uploadedRefVideo.file);

    let taskId;
    try {
      const r = await fetch(apiUrl('/api/generate'), { method: 'POST', body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (err?.error === 'INSUFFICIENT_CREDITS') {
          if (typeof err.credits === 'number') { credits = Math.max(0, err.credits); renderCredits(); }
          showInsufficientCreditsPopup(cost); if (btnGenerate) btnGenerate.disabled = false; setProgress(false); return;
        }
        throw new Error(err.message || err.error || 'Ошибка запроса');
      }
      const data = await r.json();
      if (typeof data.credits === 'number') { credits = Math.max(0, data.credits); renderCredits(); }
      taskId = data.taskId;
    } catch (e) {
      const msg = e.message || '';
      showError(msg === 'Failed to fetch' || msg.includes('network') || msg.includes('fetch') ? (currentLang === 'en' ? 'No connection to server.' : 'Нет связи с сервером.') : (msg || 'Ошибка'));
      return;
    }

    setProgress(true, currentLang === 'en' ? 'Generating video...' : 'Генерация видео...', 10);
    startProgressSimulation();

    const poll = async () => {
      try {
        const r = await fetch(apiUrl('/api/task/' + encodeURIComponent(taskId)));
        if (!r.ok) { setTimeout(poll, 5000); return; }
        const data = await r.json();
        if (data.successFlag === 1) { finishGenerate(data.resultUrl, data.galleryItem); return; }
        if (data.successFlag === 2 || data.successFlag === 3) { showError(data.errorMessage || (currentLang === 'en' ? 'Generation failed' : 'Генерация не удалась')); return; }
        setTimeout(poll, 5000);
      } catch { setTimeout(poll, 5000); }
    };
    setTimeout(poll, 5000);
  }

  if (btnGenerate) btnGenerate.addEventListener('click', startGenerate);

  // ——— Load gallery on start ———
  async function loadGalleryOnStart() {
    renderRecentGrid(); renderGalleryGrid();
    const uid = getUserId(); if (uid == null) return;
    try {
      const r = await fetch(apiUrl('/api/gallery?userId=' + encodeURIComponent(String(uid))));
      if (!r.ok) return;
      const list = await r.json();
      if (Array.isArray(list) && list.length > 0) {
        gallery.length = 0; recent.length = 0;
        list.forEach((item) => { gallery.push(item); recent.push(item); });
        renderRecentGrid(); renderGalleryGrid();
      }
    } catch { /* ignore */ }
  }

  // ——— Init ———
  updateGenerateCost();
  if (menuNickname) menuNickname.textContent = getNickname();
  if (menuCreditsEl) menuCreditsEl.textContent = String(credits);
  loadCreditsFromApi().then(() => renderCredits()).catch(() => renderCredits());
  loadGalleryOnStart();
  renderUploads();
  renderVideoUpload();
  applyLanguage();

  window.getGenerationOptions = () => ({
    model: currentModel,
    duration: $('#select-duration')?.value || '5',
    sound: $('#select-sound')?.value === 'true',
    motionMode: $('#select-motion-mode')?.value || '720p',
    orientation: $('#select-orientation')?.value || 'video',
    videoQuality: $('#select-video-quality')?.value || 'std',
    videoAspect: $('#select-video-aspect')?.value  || '16:9',
  });
})();
