export type SurveyCategory = 
  | 'Phần cứng'
  | 'Máy chiếu'
  | 'Điều hòa'
  | 'Điện'
  | 'Nội thất'
  | 'Khác';

export type SyncStatus = 'PENDING_SYNC' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface SurveyDraft {
  building: string;      // Tòa nhà: Tòa K, Tòa V, Tòa A, ...
  floor: string;         // Tầng: 1, 2, 3, 4, 5, ...
  roomNumber: string;    // Số phòng: K.201, V.102, ...
  category: SurveyCategory; // Phân loại
  rating: number;        // Đánh giá 1 - 5 sao
  issueNote: string;     // Ghi chú lỗi
  photos: string[];      // Danh sách Data URLs ảnh chụp
  step: number;          // Bước hiện tại trong wizard form (1 - 4)
  updatedAt: number;     // Thời điểm cập nhật nháp
}

export interface SurveyRecord {
  id: string;            // UUID duy nhất
  createdAt: number;     // Thời điểm gửi khảo sát
  building: string;
  floor: string;
  roomNumber: string;
  category: SurveyCategory;
  rating: number;
  issueNote: string;
  photos: string[];
  status: SyncStatus;    // Trạng thái đồng bộ
  syncError?: string;    // Lỗi khi đồng bộ (nếu có)
  syncedAt?: number;     // Thời điểm đồng bộ thành công
}

export interface NetworkState {
  connected: boolean;
  connectionType: string;
}

