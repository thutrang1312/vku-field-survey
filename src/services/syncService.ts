import { getPendingSurveys, updateSurveyStatus, saveSurvey } from '../db/surveyDb';
import type { SurveyDraft, SurveyRecord } from '../types/survey';
import { networkService } from './networkService';

type SyncProgressCallback = (total: number, remaining: number, currentItem?: SurveyRecord) => void;

class SyncService {
  private isSyncing = false;
  private progressListeners: Set<SyncProgressCallback> = new Set();
  // Cấu hình URL endpoint backend (hoặc Google Apps Script / Mock API)
  private apiEndpoint = 'https://httpbin.org/post'; // Endpoint HTTP test chuẩn

  constructor() {
    this.init();
  }

  private init() {
    // 1. Tự động đồng bộ ngay khi mạng online trở lại
    networkService.subscribe((state) => {
      if (state.connected) {
        console.log('[SyncService] Phát hiện mạng online, bắt đầu đồng bộ hàng chờ...');
        this.syncAll();
      }
    });

    // 2. Lắng nghe tin nhắn từ Service Worker (Background Sync API)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'TRIGGER_BACKGROUND_SYNC') {
          console.log('[SyncService] Nhận tín hiệu Background Sync từ Service Worker');
          this.syncAll();
        }
      });
    }
  }

  /**
   * Đăng ký Background Sync với Service Worker nếu trình duyệt hỗ trợ
   */
  public async registerBackgroundSync(): Promise<boolean> {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        // @ts-expect-error SyncManager is standard on modern Chromium
        await reg.sync.register('sync-surveys');
        console.log('[SyncService] Đã đăng ký Background Sync API thành công');
        return true;
      } catch (err) {
        console.warn('[SyncService] Không thể đăng ký Background Sync:', err);
      }
    }
    return false;
  }

  /**
   * Tạo bản ghi khảo sát mới, gán UUID, timestamp và PENDING_SYNC
   */
  public async submitSurvey(draft: SurveyDraft): Promise<SurveyRecord> {
    const isOnline = await networkService.isOnline();
    const id = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : 'survey_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    const survey: SurveyRecord = {
      id,
      createdAt: Date.now(),
      building: draft.building,
      floor: draft.floor,
      roomNumber: draft.roomNumber,
      category: draft.category,
      rating: draft.rating,
      issueNote: draft.issueNote,
      photos: [...draft.photos],
      status: 'PENDING_SYNC',
    };

    // Lưu ngay vào IndexedDB
    await saveSurvey(survey);

    // Thử đăng ký Background Sync
    await this.registerBackgroundSync();

    // Nếu đang online, kích hoạt đồng bộ ngay lập tức
    if (isOnline) {
      this.syncAll();
    }

    return survey;
  }

  /**
   * Đồng bộ tuần tự (sequential) từng bản ghi trong hàng chờ
   */
  public async syncAll(): Promise<{ successCount: number; failedCount: number }> {
    if (this.isSyncing) {
      console.log('[SyncService] Tiến trình đồng bộ đang chạy, bỏ qua gọi trùng');
      return { successCount: 0, failedCount: 0 };
    }

    const isOnline = await networkService.isOnline();
    if (!isOnline) {
      console.log('[SyncService] Thiết bị đang offline, hoãn đồng bộ');
      return { successCount: 0, failedCount: 0 };
    }

    this.isSyncing = true;
    let successCount = 0;
    let failedCount = 0;

    try {
      const pendingItems = await getPendingSurveys();
      const total = pendingItems.length;

      if (total === 0) {
        this.notifyProgress(0, 0);
        return { successCount: 0, failedCount: 0 };
      }

      console.log(`[SyncService] Bắt đầu đồng bộ ${total} khảo sát trong hàng chờ...`);

      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        const remaining = total - i;
        this.notifyProgress(total, remaining, item);

        // Đánh dấu trạng thái SYNCING
        await updateSurveyStatus(item.id, 'SYNCING');

        try {
          // Gửi dữ liệu lần lượt (tuần tự)
          await this.sendSurveyPayload(item);
          await updateSurveyStatus(item.id, 'SYNCED');
          successCount++;
          console.log(`[SyncService] Đã đồng bộ thành công khảo sát ID: ${item.id}`);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SyncService] Đồng bộ thất bại ID: ${item.id}`, errMsg);
          await updateSurveyStatus(item.id, 'FAILED', errMsg);
          failedCount++;
        }
      }

      this.notifyProgress(total, 0);
    } finally {
      this.isSyncing = false;
    }

    return { successCount, failedCount };
  }

  /**
   * Gửi dữ liệu khảo sát lên API Endpoint
   */
  private async sendSurveyPayload(survey: SurveyRecord): Promise<void> {
    const payload = {
      id: survey.id,
      timestamp: survey.createdAt,
      device: 'VKU Field Survey PWA / Android Native',
      data: {
        building: survey.building,
        floor: survey.floor,
        roomNumber: survey.roomNumber,
        category: survey.category,
        rating: survey.rating,
        issueNote: survey.issueNote,
        photosCount: survey.photos.length,
        photos: survey.photos,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Máy chủ phản hồi mã lỗi ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  public onProgress(callback: SyncProgressCallback): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  private notifyProgress(total: number, remaining: number, currentItem?: SurveyRecord) {
    for (const listener of this.progressListeners) {
      try {
        listener(total, remaining, currentItem);
      } catch (e) {
        console.error(e);
      }
    }
  }

  public getIsSyncing(): boolean {
    return this.isSyncing;
  }
}

export const syncService = new SyncService();

