import './style.css';
import type { SurveyCategory, SurveyDraft, SurveyRecord, NetworkState } from './types/survey';
import { getDraft, saveDraft, clearDraft, getAllSurveys, deleteSurvey } from './db/surveyDb';
import { networkService } from './services/networkService';
import { syncService } from './services/syncService';
import { capturePhoto, pickPhotoFromGallery } from './services/cameraService';
import { registerServiceWorker } from './swRegister';

// === Khởi tạo PWA Service Worker ===
registerServiceWorker();

// === Trạng thái ứng dụng ===
const BUILDINGS = ['Tòa K', 'Tòa V', 'Tòa A', 'Tòa B', 'Tòa C', 'Thư viện', 'Ký túc xá', 'Khu Thể thao'];
const FLOORS = ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5', 'Tầng 6'];
const CATEGORIES: SurveyCategory[] = ['Phần cứng', 'Máy chiếu', 'Điều hòa', 'Điện', 'Nội thất', 'Khác'];

const RATING_LABELS: Record<number, string> = {
  1: '⭐ (1/5) - Rất tệ / Hỏng hoàn toàn',
  2: '⭐⭐ (2/5) - Kém / Cần bảo trì gấp',
  3: '⭐⭐⭐ (3/5) - Tạm ổn / Có lỗi nhỏ',
  4: '⭐⭐⭐⭐ (4/5) - Tốt / Hoạt động bình thường',
  5: '⭐⭐⭐⭐⭐ (5/5) - Rất tốt / Thiết bị hoàn hảo'
};

const defaultDraft: SurveyDraft = {
  building: 'Tòa K',
  floor: 'Tầng 2',
  roomNumber: '',
  category: 'Máy chiếu',
  rating: 4,
  issueNote: '',
  photos: [],
  step: 1,
  updatedAt: Date.now()
};

let appState = {
  activeTab: 'survey' as 'survey' | 'queue',
  draft: { ...defaultDraft },
  surveys: [] as SurveyRecord[],
  network: networkService.getState(),
  hasDraftNotice: false,
  isSyncing: false,
  syncProgress: { total: 0, remaining: 0 },
  selectedSurveyId: null as string | null,
  lightboxImage: null as string | null,
};

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

// === Quản lý Toast Thông báo ===
function showToast(message: string, duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// === Tự động lưu nháp vào IndexedDB ===
function triggerAutoSave() {
  appState.draft.updatedAt = Date.now();
  if (autoSaveTimer) clearTimeout(autoSaveTimer);

  autoSaveTimer = setTimeout(async () => {
    await saveDraft(appState.draft);
    console.log('[Draft] Đã lưu nháp thời gian thực vào IndexedDB lúc:', new Date().toLocaleTimeString());
  }, 400);
}

// === Tải dữ liệu ban đầu ===
async function initApp() {
  // 1. Tải bản nháp đã lưu từ IndexedDB
  const savedDraft = await getDraft();
  if (savedDraft && (savedDraft.roomNumber || savedDraft.issueNote || savedDraft.photos.length > 0)) {
    appState.draft = savedDraft;
    appState.hasDraftNotice = true;
    console.log('[Draft] Đã khôi phục bản nháp từ IndexedDB');
  }

  // 2. Tải danh sách khảo sát trong IndexedDB
  appState.surveys = await getAllSurveys();

  // 3. Theo dõi trạng thái mạng
  networkService.subscribe((state: NetworkState) => {
    appState.network = state;
    render();
  });

  // 4. Lắng nghe tiến trình đồng bộ
  syncService.onProgress((total, remaining) => {
    appState.isSyncing = remaining > 0;
    appState.syncProgress = { total, remaining };
    getAllSurveys().then((list) => {
      appState.surveys = list;
      render();
    });
  });

  render();
}

// === Render Giao diện Chính ===
function render() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const pendingCount = appState.surveys.filter((s) => s.status === 'PENDING_SYNC' || s.status === 'FAILED').length;

  const selectedSurvey = appState.selectedSurveyId
    ? appState.surveys.find((s) => s.id === appState.selectedSurveyId)
    : null;

  root.innerHTML = `
    <!-- Header ứng dụng -->
    <header class="app-header">
      <div class="header-top">
        <div class="brand">
          <img src="/icon-192.png" alt="VKU Survey Logo" class="brand-icon" />
          <div class="brand-info">
            <h1>VKU Field Survey</h1>
            <span>Khảo sát cơ sở vật chất</span>
          </div>
        </div>
        <div class="network-pill ${appState.network.connected ? 'online' : 'offline'}">
          <div class="pulse-dot"></div>
          <span>${appState.network.connected ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      <!-- Tabs chuyển đổi -->
      <nav class="nav-tabs">
        <button class="tab-btn ${appState.activeTab === 'survey' ? 'active' : ''}" id="tab-survey-btn">
          📝 Khảo sát mới
        </button>
        <button class="tab-btn ${appState.activeTab === 'queue' ? 'active' : ''}" id="tab-queue-btn">
          🔄 Hàng chờ & Lịch sử
          ${pendingCount > 0 ? `<span class="badge ${appState.network.connected ? '' : 'warning'}">${pendingCount}</span>` : ''}
        </button>
      </nav>
    </header>

    <!-- Nội dung Tab chính -->
    <main class="main-content">
      ${appState.activeTab === 'survey' ? renderSurveyTab() : renderQueueTab()}
    </main>

    <!-- Popup / Modal Chi Tiết Phiếu Khảo Sát -->
    ${selectedSurvey ? renderDetailModal(selectedSurvey) : ''}

    <!-- Lightbox phóng to ảnh -->
    ${appState.lightboxImage ? renderLightboxModal(appState.lightboxImage) : ''}
  `;

  attachEventListeners();
}

// === Render Tab Form Khảo sát Đa bước ===
function renderSurveyTab(): string {
  const d = appState.draft;

  return `
    ${appState.hasDraftNotice ? `
      <div class="draft-alert">
        <span>💾 Đã tự động khôi phục bản nháp chưa gửi của bạn.</span>
        <button id="btn-discard-draft">Hủy nháp</button>
      </div>
    ` : ''}

    <!-- Stepper chỉ báo các bước -->
    <div class="stepper">
      <div class="step-item ${d.step === 1 ? 'active' : ''} ${d.step > 1 ? 'completed' : ''}">
        <div class="step-circle">${d.step > 1 ? '✓' : '1'}</div>
        <div class="step-label">Vị trí</div>
      </div>
      <div class="step-item ${d.step === 2 ? 'active' : ''} ${d.step > 2 ? 'completed' : ''}">
        <div class="step-circle">${d.step > 2 ? '✓' : '2'}</div>
        <div class="step-label">Phân loại</div>
      </div>
      <div class="step-item ${d.step === 3 ? 'active' : ''} ${d.step > 3 ? 'completed' : ''}">
        <div class="step-circle">${d.step > 3 ? '✓' : '3'}</div>
        <div class="step-label">Minh chứng</div>
      </div>
      <div class="step-item ${d.step === 4 ? 'active' : ''}">
        <div class="step-circle">4</div>
        <div class="step-label">Xác nhận</div>
      </div>
    </div>

    <!-- Khối thẻ nội dung theo bước -->
    <div class="form-card">
      ${renderStepContent(d.step)}
    </div>
  `;
}

// === Render Từng bước trong Wizard ===
function renderStepContent(step: number): string {
  const d = appState.draft;

  if (step === 1) {
    return `
      <h2 class="card-title">📍 Bước 1: Vị trí kiểm tra</h2>
      <p class="card-subtitle">Chọn tòa nhà, tầng và nhập mã số phòng thực địa</p>

      <label class="label">Tòa nhà</label>
      <div class="chip-group" id="group-building">
        ${BUILDINGS.map(b => `
          <button type="button" class="chip ${d.building === b ? 'selected' : ''}" data-building="${b}">
            🏢 ${b}
          </button>
        `).join('')}
      </div>

      <label class="label">Tầng</label>
      <div class="chip-group" id="group-floor">
        ${FLOORS.map(f => `
          <button type="button" class="chip ${d.floor === f ? 'selected' : ''}" data-floor="${f}">
            ${f}
          </button>
        `).join('')}
      </div>

      <label class="label" for="input-room">Số phòng / Khu vực</label>
      <input type="text" id="input-room" class="text-input" placeholder="Ví dụ: K.201, V.102, Lab 4..." value="${escapeHtml(d.roomNumber)}" />
      <div class="quick-suggestions">
        <span class="suggestion-pill" data-val="${d.building.replace('Tòa ', '')}.101">${d.building.replace('Tòa ', '')}.101</span>
        <span class="suggestion-pill" data-val="${d.building.replace('Tòa ', '')}.202">${d.building.replace('Tòa ', '')}.202</span>
        <span class="suggestion-pill" data-val="${d.building.replace('Tòa ', '')}.305">${d.building.replace('Tòa ', '')}.305</span>
        <span class="suggestion-pill" data-val="Lab Máy tính 3">Lab Máy tính 3</span>
      </div>

      <div class="form-actions">
        <button class="btn-primary" id="btn-next-step">Tiếp tục sang bước 2 ➜</button>
      </div>
    `;
  }

  if (step === 2) {
    return `
      <h2 class="card-title">⚙️ Bước 2: Phân loại & Đánh giá</h2>
      <p class="card-subtitle">Chọn danh mục cơ sở vật chất và mức độ thẩm định</p>

      <label class="label">Phân loại hạng mục</label>
      <div class="chip-group" id="group-category">
        ${CATEGORIES.map(cat => `
          <button type="button" class="chip ${d.category === cat ? 'selected' : ''}" data-category="${cat}">
            ${getCategoryIcon(cat)} ${cat}
          </button>
        `).join('')}
      </div>

      <label class="label">Đánh giá chất lượng hiện trạng</label>
      <div class="star-rating-box">
        <div class="stars" id="star-rating-container">
          ${[1, 2, 3, 4, 5].map(star => `
            <button type="button" class="star-btn ${star <= d.rating ? 'filled' : ''}" data-star="${star}">★</button>
          `).join('')}
        </div>
        <span class="rating-text">${RATING_LABELS[d.rating] || ''}</span>
      </div>

      <div class="form-actions">
        <button class="btn-secondary" id="btn-prev-step">⬅ Quay lại</button>
        <button class="btn-primary" id="btn-next-step">Tiếp tục sang bước 3 ➜</button>
      </div>
    `;
  }

  if (step === 3) {
    return `
      <h2 class="card-title">📸 Bước 3: Ghi chú & Ảnh chụp</h2>
      <p class="card-subtitle">Ghi nhận chi tiết tình trạng sự cố và chụp ảnh minh chứng</p>

      <label class="label" for="input-note">Mô tả sự cố / Ghi chú kỹ thuật</label>
      <textarea id="input-note" class="text-input" rows="3" placeholder="Mô tả sự cố chi tiết (ví dụ: máy chiếu mờ, điều hòa chảy nước, dây điện hở...)">${escapeHtml(d.issueNote)}</textarea>

      <label class="label" style="margin-top: 14px;">Ảnh minh chứng hiện trường (${d.photos.length} ảnh)</label>
      <div class="camera-buttons">
        <button type="button" class="btn-cam" id="btn-capture-camera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          Chụp ảnh Camera
        </button>
        <button type="button" class="btn-cam" id="btn-pick-gallery">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          Chọn từ Thư viện
        </button>
      </div>

      ${d.photos.length > 0 ? `
        <div class="photo-grid">
          ${d.photos.map((photo, idx) => `
            <div class="photo-thumb-container">
              <img src="${photo}" class="photo-thumb" alt="Minh chứng ${idx + 1}" />
              <button type="button" class="photo-remove-btn" data-photo-idx="${idx}" title="Xóa ảnh">✕</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="form-actions">
        <button class="btn-secondary" id="btn-prev-step">⬅ Quay lại</button>
        <button class="btn-primary" id="btn-next-step">Xem lại & Gửi ➜</button>
      </div>
    `;
  }

  // Step 4: Xem lại & Gửi
  return `
    <h2 class="card-title">✅ Bước 4: Kiểm tra & Xác nhận gửi</h2>
    <p class="card-subtitle">Vui lòng kiểm tra lại toàn bộ thông tin khảo sát trước khi lưu</p>

    <div class="summary-list">
      <div class="summary-row">
        <span class="summary-label">Vị trí:</span>
        <span class="summary-value">${escapeHtml(d.building)} - ${escapeHtml(d.floor)} - Phòng: ${escapeHtml(d.roomNumber || '(Chưa nhập)')}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Phân loại:</span>
        <span class="summary-value">${getCategoryIcon(d.category)} ${escapeHtml(d.category)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Đánh giá:</span>
        <span class="summary-value">${RATING_LABELS[d.rating]}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Ghi chú lỗi:</span>
        <span class="summary-value">${escapeHtml(d.issueNote) || '(Không có)'}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Ảnh đính kèm:</span>
        <span class="summary-value">${d.photos.length} tệp ảnh</span>
      </div>
    </div>

    <!-- Banner trạng thái mạng & hành vi đồng bộ -->
    <div class="network-alert-box ${appState.network.connected ? 'online' : 'offline'}">
      <div>${appState.network.connected ? '🟢' : '🟠'}</div>
      <div>
        <strong>${appState.network.connected ? 'Thiết bị đang Trực tuyến (Online)' : 'Thiết bị đang Ngoại tuyến (Offline)'}</strong>
        <p style="font-size: 0.8rem; margin-top: 2px;">
          ${appState.network.connected
            ? 'Khảo sát sẽ được gửi ngay lập tức lên hệ thống lưu trữ VKU.'
            : 'Khảo sát sẽ được lưu an toàn vào IndexedDB với trạng thái PENDING_SYNC và tự động đồng bộ tuần tự khi có mạng trở lại.'
          }
        </p>
      </div>
    </div>

    <div class="form-actions">
      <button class="btn-secondary" id="btn-prev-step">⬅ Sửa lại</button>
      <button class="btn-primary" id="btn-submit-survey">
        🚀 Gửi Khảo Sát
      </button>
    </div>
  `;
}

// === Render Tab Hàng chờ & Lịch sử ===
function renderQueueTab(): string {
  const surveys = appState.surveys;
  const pendingCount = surveys.filter(s => s.status === 'PENDING_SYNC' || s.status === 'FAILED').length;

  return `
    <div class="queue-header">
      <div>
        <h2 class="queue-title">📋 Hàng chờ & Lịch sử</h2>
        <span style="font-size: 0.8rem; color: var(--gray-500);">
          ${surveys.length} bản ghi tổng cộng | ${pendingCount} cần đồng bộ
        </span>
      </div>
      <button class="btn-sync-all" id="btn-sync-now" ${appState.isSyncing || pendingCount === 0 || !appState.network.connected ? 'disabled' : ''}>
        ${appState.isSyncing ? `
          <span class="spin">🔄</span> Đang gửi...
        ` : `
          🔄 Đồng bộ ngay
        `}
      </button>
    </div>

    ${appState.isSyncing ? `
      <div class="draft-alert" style="margin-bottom: 12px;">
        <span>⏳ Đang đồng bộ lần lượt các bản ghi (${appState.syncProgress.total - appState.syncProgress.remaining}/${appState.syncProgress.total})...</span>
      </div>
    ` : ''}

    ${surveys.length === 0 ? `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
          <rect x="9" y="3" width="6" height="4" rx="2"></rect>
          <path d="M9 14l2 2 4-4"></path>
        </svg>
        <p>Chưa có dữ liệu khảo sát nào được lưu.</p>
        <p style="font-size: 0.8rem; margin-top: 4px;">Hãy tạo khảo sát mới ở tab "Khảo sát mới".</p>
      </div>
    ` : `
      <div class="survey-list">
        ${surveys.map(s => renderSurveyItem(s)).join('')}
      </div>
    `}
  `;
}

function renderSurveyItem(s: SurveyRecord): string {
  const statusLabels: Record<string, string> = {
    PENDING_SYNC: '⏳ Chờ đồng bộ',
    SYNCING: '🔄 Đang đồng bộ...',
    SYNCED: '✅ Đã đồng bộ',
    FAILED: '❌ Thất bại'
  };

  const dateStr = new Date(s.createdAt).toLocaleString('vi-VN');

  return `
    <div class="survey-item-card" data-survey-id="${s.id}" title="Nhấn để xem chi tiết phiếu khảo sát">
      <div class="survey-item-top">
        <span class="survey-item-loc">📍 ${escapeHtml(s.building)} - ${escapeHtml(s.floor)} - ${escapeHtml(s.roomNumber || 'Khu chung')}</span>
        <span class="status-badge ${s.status}">
          ${statusLabels[s.status] || s.status}
        </span>
      </div>

      <div class="survey-meta">
        <span>${getCategoryIcon(s.category)} ${escapeHtml(s.category)}</span>
        <span>⭐ ${s.rating}/5 sao</span>
        <span>📸 ${s.photos.length} ảnh</span>
      </div>

      ${s.issueNote ? `
        <div class="survey-note-snippet">
          "${escapeHtml(s.issueNote)}"
        </div>
      ` : ''}

      ${s.syncError ? `
        <div style="font-size: 0.75rem; color: var(--danger); margin-bottom: 6px;">
          ⚠️ ${escapeHtml(s.syncError)}
        </div>
      ` : ''}

      <div class="survey-item-bottom">
        <span>🕒 ${dateStr}</span>
        <span>ID: ${s.id.slice(0, 8)}...</span>
      </div>

      <div class="card-click-hint">
        🔍 Nhấn để xem toàn bộ chi tiết & ảnh chụp ➔
      </div>
    </div>
  `;
}

// === Render Popup / Modal Chi Tiết Phiếu Khảo Sát ===
function renderDetailModal(s: SurveyRecord): string {
  const statusLabels: Record<string, string> = {
    PENDING_SYNC: '⏳ Chờ đồng bộ (Offline Queue)',
    SYNCING: '🔄 Đang đồng bộ dữ liệu...',
    SYNCED: '✅ Đã đồng bộ thành công',
    FAILED: '❌ Đồng bộ thất bại'
  };

  const createdDateStr = new Date(s.createdAt).toLocaleString('vi-VN', {
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  const syncedDateStr = s.syncedAt
    ? new Date(s.syncedAt).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'medium' })
    : 'Chưa đồng bộ (Đang lưu trong IndexedDB)';

  // Tính dung lượng tổng các ảnh Base64
  const totalPhotoBytes = s.photos.reduce((acc, p) => acc + Math.round((p.length * 3) / 4), 0);
  const photoSizeDisplay = totalPhotoBytes > 0
    ? totalPhotoBytes > 1024 * 1024
      ? (totalPhotoBytes / (1024 * 1024)).toFixed(2) + ' MB'
      : (totalPhotoBytes / 1024).toFixed(1) + ' KB'
    : '0 KB';

  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card">
        <!-- Header Modal -->
        <div class="modal-header">
          <div class="modal-title">
            <span>📄 Phiếu Khảo Sát Chi Tiết</span>
          </div>
          <button class="modal-close-btn" id="modal-close-btn" title="Đóng popup">✕</button>
        </div>

        <!-- Body Modal -->
        <div class="modal-body">
          <!-- Banner Tóm Tắt Vị Trí & Hạng Mục -->
          <div class="detail-banner">
            <div>
              <div class="detail-banner-main">
                📍 ${escapeHtml(s.building)} - ${escapeHtml(s.floor)} - ${escapeHtml(s.roomNumber || 'Khu vực chung')}
              </div>
              <div class="detail-banner-sub">
                ${getCategoryIcon(s.category)} Hạng mục: <strong>${escapeHtml(s.category)}</strong>
              </div>
            </div>
            <div style="text-align: right;">
              <span class="status-badge ${s.status}">${statusLabels[s.status] || s.status}</span>
              <div style="font-size: 0.75rem; color: #eab308; font-weight: 700; margin-top: 4px;">
                ⭐ ${s.rating}/5 sao
              </div>
            </div>
          </div>

          <!-- Mức độ đánh giá chất lượng -->
          <div class="detail-section">
            <div class="detail-section-title">⭐ Mức độ thẩm định chất lượng</div>
            <div style="background: var(--gray-50); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--gray-200); font-weight: 600; font-size: 0.9rem; color: var(--gray-800);">
              ${RATING_LABELS[s.rating]}
            </div>
          </div>

          <!-- Ghi chú lỗi & Sự cố kỹ thuật -->
          <div class="detail-section">
            <div class="detail-section-title">📝 Ghi chú sự cố / Mô tả kỹ thuật</div>
            <div class="note-full-box ${!s.issueNote ? 'note-empty' : ''}">
              ${s.issueNote ? escapeHtml(s.issueNote) : 'Không có ghi chú sự cố nào được cung cấp cho phiếu này.'}
            </div>
          </div>

          <!-- Ảnh chụp minh chứng Base64 -->
          <div class="detail-section">
            <div class="detail-section-title">
              📸 Ảnh chụp minh chứng thực địa (${s.photos.length} ảnh - ${photoSizeDisplay})
            </div>

            ${s.photos.length > 0 ? `
              <div class="modal-photo-grid">
                ${s.photos.map((photo, index) => `
                  <div class="modal-photo-thumb-wrap" title="Nhấn để phóng to ảnh ${index + 1}">
                    <img src="${photo}" class="modal-photo-img" alt="Minh chứng Base64 #${index + 1}" />
                    <span class="photo-badge">#${index + 1} 🔍</span>
                  </div>
                `).join('')}
              </div>
              <span style="font-size: 0.75rem; color: var(--gray-500); font-style: italic;">
                💡 Nhấn vào bất kỳ ảnh nào để xem kích thước đầy đủ (Base64 DataURL).
              </span>
            ` : `
              <div style="font-size: 0.85rem; color: var(--gray-400); font-style: italic; background: var(--gray-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
                Không có ảnh chụp minh chứng nào đính kèm trong phiếu này.
              </div>
            `}
          </div>

          <!-- Thông số Kỹ thuật & Siêu dữ liệu hệ thống -->
          <div class="detail-section">
            <div class="detail-section-title">⚙️ Thông số kỹ thuật & Hệ thống</div>
            <div class="tech-specs-table">
              <div class="spec-row">
                <span class="spec-key">Mã định danh (UUID):</span>
                <span class="spec-value">
                  <span class="spec-uuid" title="${s.id}">${s.id}</span>
                  <button class="btn-copy-icon" id="btn-copy-uuid" data-uuid="${s.id}" title="Sao chép UUID">📋</button>
                </span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Thời gian tạo phiếu:</span>
                <span class="spec-value">${createdDateStr}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Trạng thái hàng chờ:</span>
                <span class="spec-value">
                  <span class="status-badge ${s.status}">${s.status}</span>
                </span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Thời gian đồng bộ:</span>
                <span class="spec-value">${syncedDateStr}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Cơ sở dữ liệu lưu trữ:</span>
                <span class="spec-value">IndexedDB (Store: surveys)</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Nền tảng ứng dụng:</span>
                <span class="spec-value">VKU Field Survey PWA Standalone</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Dung lượng ảnh Base64:</span>
                <span class="spec-value">${photoSizeDisplay} (${s.photos.length} tệp)</span>
              </div>
              ${s.syncError ? `
                <div class="spec-row" style="background: var(--danger-light); color: var(--danger);">
                  <span class="spec-key" style="color: var(--danger); font-weight: 700;">Lỗi đồng bộ:</span>
                  <span class="spec-value" style="color: var(--danger); font-size: 0.78rem;">${escapeHtml(s.syncError)}</span>
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Footer Modal -->
        <div class="modal-footer">
          <button class="btn-delete-survey" id="btn-delete-survey" title="Xóa vĩnh viễn phiếu khảo sát này khỏi máy">
            🗑️ Xóa phiếu
          </button>
          <div class="modal-footer-actions">
            <button class="btn-secondary" id="btn-copy-all-info" style="padding: 8px 12px; font-size: 0.82rem;">
              📋 Sao chép thông tin
            </button>
            <button class="btn-primary" id="btn-close-modal-bottom" style="padding: 8px 16px; font-size: 0.82rem;">
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// === Render Lightbox Phóng To Ảnh ===
function renderLightboxModal(imgSrc: string): string {
  return `
    <div class="lightbox-backdrop" id="lightbox-backdrop">
      <div class="lightbox-content">
        <button class="lightbox-close-btn" id="lightbox-close-btn" title="Đóng ảnh">✕</button>
        <img src="${imgSrc}" class="lightbox-img" alt="Ảnh phóng to" />
      </div>
    </div>
  `;
}

// === Gắn Sự kiện Tương tác (Event Listeners) ===
function attachEventListeners() {
  // Chuyển Tab
  document.querySelector('#tab-survey-btn')?.addEventListener('click', () => {
    appState.activeTab = 'survey';
    render();
  });

  document.querySelector('#tab-queue-btn')?.addEventListener('click', () => {
    appState.activeTab = 'queue';
    render();
  });

  // Mở Popup khi bấm vào thẻ khảo sát
  document.querySelectorAll<HTMLElement>('.survey-item-card').forEach((card) => {
    card.addEventListener('click', () => {
      const surveyId = card.dataset.surveyId;
      if (surveyId) {
        appState.selectedSurveyId = surveyId;
        render();
      }
    });
  });

  // Đóng Popup Modal
  document.querySelector('#modal-close-btn')?.addEventListener('click', () => {
    appState.selectedSurveyId = null;
    render();
  });

  document.querySelector('#btn-close-modal-bottom')?.addEventListener('click', () => {
    appState.selectedSurveyId = null;
    render();
  });

  document.querySelector('#modal-backdrop')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-backdrop') {
      appState.selectedSurveyId = null;
      render();
    }
  });

  // Mở Lightbox phóng to ảnh trong Modal
  document.querySelectorAll<HTMLElement>('.modal-photo-thumb-wrap').forEach((wrap) => {
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = wrap.querySelector<HTMLImageElement>('img');
      if (img && img.src) {
        appState.lightboxImage = img.src;
        render();
      }
    });
  });

  // Đóng Lightbox phóng to ảnh
  document.querySelector('#lightbox-close-btn')?.addEventListener('click', () => {
    appState.lightboxImage = null;
    render();
  });

  document.querySelector('#lightbox-backdrop')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'lightbox-backdrop') {
      appState.lightboxImage = null;
      render();
    }
  });

  // Sao chép UUID
  document.querySelector('#btn-copy-uuid')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const uuid = (e.currentTarget as HTMLElement).dataset.uuid;
    if (uuid) {
      navigator.clipboard.writeText(uuid);
      showToast('📋 Đã sao chép UUID vào clipboard!');
    }
  });

  // Sao chép toàn bộ thông tin phiếu
  document.querySelector('#btn-copy-all-info')?.addEventListener('click', () => {
    const selected = appState.surveys.find((s) => s.id === appState.selectedSurveyId);
    if (selected) {
      const text = [
        `VKU FIELD SURVEY - PHIẾU KHẢO SÁT CHI TIẾT`,
        `=========================================`,
        `Mã định danh (UUID): ${selected.id}`,
        `Thời gian tạo: ${new Date(selected.createdAt).toLocaleString('vi-VN')}`,
        `Vị trí: ${selected.building} - ${selected.floor} - Phòng: ${selected.roomNumber || 'Chung'}`,
        `Phân loại: ${selected.category}`,
        `Đánh giá: ${RATING_LABELS[selected.rating]}`,
        `Ghi chú sự cố: ${selected.issueNote || '(Không có)'}`,
        `Số lượng ảnh đính kèm: ${selected.photos.length}`,
        `Trạng thái đồng bộ: ${selected.status}`,
        selected.syncedAt ? `Thời điểm đồng bộ: ${new Date(selected.syncedAt).toLocaleString('vi-VN')}` : `Chưa đồng bộ`,
        selected.syncError ? `Lỗi đồng bộ: ${selected.syncError}` : ``
      ].filter(Boolean).join('\n');

      navigator.clipboard.writeText(text);
      showToast('📋 Đã sao chép toàn bộ thông tin phiếu!');
    }
  });

  // Xóa phiếu khảo sát khỏi IndexedDB
  document.querySelector('#btn-delete-survey')?.addEventListener('click', async () => {
    const selected = appState.surveys.find((s) => s.id === appState.selectedSurveyId);
    if (!selected) return;

    const confirmDelete = confirm(
      `Bạn có chắc chắn muốn xóa vĩnh viễn phiếu khảo sát "${selected.building} - Phòng ${selected.roomNumber || 'Chung'}" không?`
    );
    if (confirmDelete) {
      await deleteSurvey(selected.id);
      appState.selectedSurveyId = null;
      appState.surveys = await getAllSurveys();
      showToast('🗑️ Đã xóa phiếu khảo sát.');
      render();
    }
  });

  // Nút Hủy bản nháp
  document.querySelector('#btn-discard-draft')?.addEventListener('click', async () => {
    if (confirm('Bạn có chắc chắn muốn hủy bỏ toàn bộ bản nháp đang lưu không?')) {
      await clearDraft();
      appState.draft = { ...defaultDraft };
      appState.hasDraftNotice = false;
      showToast('Đã xóa bản nháp.');
      render();
    }
  });

  // Chọn Tòa nhà
  document.querySelectorAll<HTMLButtonElement>('#group-building .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.draft.building = btn.dataset.building || 'Tòa K';
      triggerAutoSave();
      render();
    });
  });

  // Chọn Tầng
  document.querySelectorAll<HTMLButtonElement>('#group-floor .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.draft.floor = btn.dataset.floor || 'Tầng 1';
      triggerAutoSave();
      render();
    });
  });

  // Nhập Số phòng
  const inputRoom = document.querySelector<HTMLInputElement>('#input-room');
  if (inputRoom) {
    inputRoom.addEventListener('input', (e) => {
      appState.draft.roomNumber = (e.target as HTMLInputElement).value;
      triggerAutoSave();
    });
  }

  // Gợi ý nhanh số phòng
  document.querySelectorAll<HTMLElement>('.suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      appState.draft.roomNumber = pill.dataset.val || '';
      triggerAutoSave();
      render();
    });
  });

  // Chọn Phân loại
  document.querySelectorAll<HTMLButtonElement>('#group-category .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.draft.category = (btn.dataset.category || 'Phần cứng') as SurveyCategory;
      triggerAutoSave();
      render();
    });
  });

  // Chọn Đánh giá Sao
  document.querySelectorAll<HTMLButtonElement>('#star-rating-container .star-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const star = parseInt(btn.dataset.star || '5', 10);
      appState.draft.rating = star;
      triggerAutoSave();
      render();
    });
  });

  // Ghi chú sự cố
  const inputNote = document.querySelector<HTMLTextAreaElement>('#input-note');
  if (inputNote) {
    inputNote.addEventListener('input', (e) => {
      appState.draft.issueNote = (e.target as HTMLTextAreaElement).value;
      triggerAutoSave();
    });
  }

  // Chụp ảnh Camera Native qua Capacitor
  document.querySelector('#btn-capture-camera')?.addEventListener('click', async () => {
    try {
      const photo = await capturePhoto();
      if (photo) {
        appState.draft.photos.push(photo);
        triggerAutoSave();
        showToast('Đã chụp và lưu ảnh vào bản nháp!');
        render();
      }
    } catch (err) {
      console.error(err);
      showToast('Không thể chụp ảnh.');
    }
  });

  // Chọn ảnh từ Thư viện
  document.querySelector('#btn-pick-gallery')?.addEventListener('click', async () => {
    try {
      const photo = await pickPhotoFromGallery();
      if (photo) {
        appState.draft.photos.push(photo);
        triggerAutoSave();
        showToast('Đã thêm ảnh từ thư viện!');
        render();
      }
    } catch (err) {
      console.error(err);
      showToast('Không thể chọn ảnh.');
    }
  });

  // Xóa ảnh đã chụp
  document.querySelectorAll<HTMLButtonElement>('.photo-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.photoIdx || '-1', 10);
      if (idx >= 0) {
        appState.draft.photos.splice(idx, 1);
        triggerAutoSave();
        render();
      }
    });
  });

  // Chuyển bước Wizard (Next / Prev)
  document.querySelector('#btn-next-step')?.addEventListener('click', () => {
    if (appState.draft.step === 1 && !appState.draft.roomNumber.trim()) {
      showToast('⚠️ Vui lòng nhập số phòng hoặc khu vực kiểm tra.');
      return;
    }
    appState.draft.step = Math.min(4, appState.draft.step + 1);
    triggerAutoSave();
    render();
  });

  document.querySelector('#btn-prev-step')?.addEventListener('click', () => {
    appState.draft.step = Math.max(1, appState.draft.step - 1);
    triggerAutoSave();
    render();
  });

  // Nút Gửi Khảo Sát Hoàn Tất
  document.querySelector('#btn-submit-survey')?.addEventListener('click', async () => {
    const btn = document.querySelector<HTMLButtonElement>('#btn-submit-survey');
    if (btn) btn.disabled = true;

    try {
      // Gửi vào hàng chờ / sync service
      await syncService.submitSurvey(appState.draft);

      // Xóa nháp sau khi gửi thành công
      await clearDraft();
      appState.draft = { ...defaultDraft, step: 1 };
      appState.hasDraftNotice = false;

      // Cập nhật lại danh sách khảo sát
      appState.surveys = await getAllSurveys();

      if (appState.network.connected) {
        showToast('🎉 Đã gửi khảo sát và đồng bộ thành công!');
      } else {
        showToast('📦 Đang offline. Khảo sát đã được lưu vào hàng chờ PENDING_SYNC!');
      }

      // Tự động chuyển sang tab Hàng chờ để người dùng theo dõi
      appState.activeTab = 'queue';
      render();
    } catch (err) {
      console.error(err);
      showToast('Có lỗi xảy ra khi lưu khảo sát.');
      if (btn) btn.disabled = false;
    }
  });

  // Nút Đồng bộ ngay trên Tab Hàng chờ
  document.querySelector('#btn-sync-now')?.addEventListener('click', async () => {
    if (!appState.network.connected) {
      showToast('⚠️ Thiết bị chưa có kết nối mạng.');
      return;
    }
    showToast('Đang tiến hành đồng bộ các khảo sát trong hàng chờ...');
    await syncService.syncAll();
    appState.surveys = await getAllSurveys();
    render();
  });
}

// === Tiện ích hỗ trợ ===
function getCategoryIcon(category: SurveyCategory): string {
  switch (category) {
    case 'Phần cứng': return '💻';
    case 'Máy chiếu': return '📽️';
    case 'Điều hòa': return '❄️';
    case 'Điện': return '⚡';
    case 'Nội thất': return '🪑';
    default: return '🔧';
  }
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Khởi chạy ứng dụng
initApp();
