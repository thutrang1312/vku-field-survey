import { supabase, isSupabaseConfigured } from '../supabase.js';
import {
  saveSurvey as saveToIndexedDB,
  getAllSurveys as getFromIndexedDB,
  updateSurveyStatus,
  deleteSurvey as deleteFromIndexedDB
} from '../db/surveyDb.ts';

/**
 * Hàm chuẩn hóa dữ liệu từ Supabase Row sang SurveyRecord của ứng dụng
 */
function normalizeSurveyRow(row) {
  return {
    id: row.id,
    building: row.building,
    floor: row.floor,
    roomNumber: row.room_number ?? row.roomNumber ?? '',
    category: row.category,
    rating: Number(row.rating) || 5,
    issueNote: row.issue_note ?? row.issueNote ?? '',
    photos: Array.isArray(row.photos) ? row.photos : [],
    status: row.status || 'SYNCED',
    createdAt: row.created_at
      ? new Date(row.created_at).getTime()
      : (row.createdAt ? new Date(row.createdAt).getTime() : Date.now()),
    syncedAt: row.synced_at
      ? new Date(row.synced_at).getTime()
      : Date.now()
  };
}

/**
 * 1. Chèn (insert) dữ liệu khảo sát mới vào bảng "surveys" trong PostgreSQL (Supabase)
 * Tự động lưu offline vào IndexedDB nếu mất mạng và hỗ trợ đồng bộ tự động.
 */
export async function saveSurvey(surveyData) {
  const id = surveyData.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'survey_' + Date.now());
  const createdAt = surveyData.createdAt || Date.now();

  // Chuẩn bị payload tương thích với bảng PostgreSQL
  const dbPayload = {
    id: id,
    building: surveyData.building,
    floor: surveyData.floor,
    room_number: surveyData.roomNumber || '',
    category: surveyData.category,
    rating: Number(surveyData.rating) || 5,
    issue_note: surveyData.issueNote || '',
    photos: surveyData.photos || [],
    status: 'SYNCED',
    created_at: new Date(createdAt).toISOString()
  };

  // Đối tượng lưu cục bộ IndexedDB
  const localRecord = {
    id: id,
    building: surveyData.building,
    floor: surveyData.floor,
    roomNumber: surveyData.roomNumber || '',
    category: surveyData.category,
    rating: Number(surveyData.rating) || 5,
    issueNote: surveyData.issueNote || '',
    photos: surveyData.photos || [],
    status: isSupabaseConfigured && navigator.onLine ? 'SYNCED' : 'PENDING_SYNC',
    createdAt: createdAt,
    syncedAt: isSupabaseConfigured && navigator.onLine ? Date.now() : undefined
  };

  // 1. Luôn lưu bản sao vào IndexedDB trước để đảm bảo an toàn dữ liệu Offline-first
  await saveToIndexedDB(localRecord);

  // 2. Nếu có mạng và đã cấu hình Supabase, đẩy trực tiếp lên PostgreSQL
  if (isSupabaseConfigured && navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('surveys')
        .insert([dbPayload])
        .select();

      if (error) {
        console.warn('[Supabase] Không thể chèn vào PostgreSQL, đánh dấu PENDING_SYNC:', error.message);
        await updateSurveyStatus(id, 'PENDING_SYNC', error.message);
        localRecord.status = 'PENDING_SYNC';
      } else {
        console.log('[Supabase] Đã lưu khảo sát thành công lên PostgreSQL:', data);
        await updateSurveyStatus(id, 'SYNCED');
        localRecord.status = 'SYNCED';
      }
    } catch (err) {
      console.warn('[Supabase] Lỗi kết nối mạng khi gửi:', err);
      await updateSurveyStatus(id, 'PENDING_SYNC', String(err));
      localRecord.status = 'PENDING_SYNC';
    }
  } else {
    console.log('[Offline] Đang offline hoặc chưa cấu hình Supabase. Khảo sát đã được lưu an toàn vào IndexedDB.');
  }

  return localRecord;
}

/**
 * 2. Lấy danh sách khảo sát từ bảng "surveys" trong PostgreSQL sắp xếp mới nhất
 * Nếu đang offline hoặc lỗi mạng, tự động trả về dữ liệu từ IndexedDB.
 */
export async function fetchSurveys() {
  if (isSupabaseConfigured && navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('surveys')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[Supabase] Lỗi khi tải danh sách từ PostgreSQL, sử dụng IndexedDB:', error.message);
        return await getFromIndexedDB();
      }

      if (data) {
        const normalized = data.map(normalizeSurveyRow);

        // Đồng bộ ngược lại các bản ghi từ server vào IndexedDB để dùng offline
        for (const item of normalized) {
          await saveToIndexedDB(item);
        }

        // Kết hợp với các bản ghi đang PENDING_SYNC cục bộ (chưa kịp gửi)
        const localList = await getFromIndexedDB();
        const pendingLocals = localList.filter(l => l.status === 'PENDING_SYNC');
        const map = new Map();

        normalized.forEach(item => map.set(item.id, item));
        pendingLocals.forEach(item => map.set(item.id, item));

        const combined = Array.from(map.values());
        combined.sort((a, b) => b.createdAt - a.createdAt);
        return combined;
      }
    } catch (err) {
      console.warn('[Supabase] Lỗi kết nối mạng khi tải khảo sát, fallback IndexedDB:', err);
    }
  }

  // Fallback offline IndexedDB
  return await getFromIndexedDB();
}

/**
 * 3. Lắng nghe thay đổi dữ liệu thời gian thực (Realtime) từ bảng "surveys"
 * Tự động cập nhật UI trên cả Web và Android khi có người dùng thêm hoặc sửa khảo sát.
 */
export function subscribeSurveys(callback) {
  // Lấy dữ liệu ban đầu
  fetchSurveys().then(surveys => {
    callback(surveys);
  });

  if (!isSupabaseConfigured) {
    console.log('[Supabase Realtime] Chưa cấu hình Supabase, chỉ cập nhật từ IndexedDB.');
    return () => {};
  }

  // Đăng ký kênh Realtime postgres_changes
  const channel = supabase
    .channel('public:surveys')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'surveys'
      },
      async (payload) => {
        console.log('[Supabase Realtime] Nhận sự kiện thay đổi dữ liệu:', payload);
        const updatedList = await fetchSurveys();
        callback(updatedList);
      }
    )
    .subscribe((status) => {
      console.log('[Supabase Realtime] Trạng thái kết nối kênh:', status);
    });

  return () => {
    console.log('[Supabase Realtime] Hủy đăng ký kênh public:surveys');
    supabase.removeChannel(channel);
  };
}

/**
 * Đồng bộ tất cả các bản ghi PENDING_SYNC lên Supabase PostgreSQL khi có mạng
 */
export async function syncPendingToSupabase() {
  if (!isSupabaseConfigured || !navigator.onLine) return { synced: 0, failed: 0 };

  const allLocal = await getFromIndexedDB();
  const pending = allLocal.filter(s => s.status === 'PENDING_SYNC');

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const payload = {
        id: item.id,
        building: item.building,
        floor: item.floor,
        room_number: item.roomNumber,
        category: item.category,
        rating: item.rating,
        issue_note: item.issueNote,
        photos: item.photos,
        status: 'SYNCED',
        created_at: new Date(item.createdAt).toISOString()
      };

      const { error } = await supabase
        .from('surveys')
        .upsert([payload]);

      if (!error) {
        await updateSurveyStatus(item.id, 'SYNCED');
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Xóa một phiếu khảo sát khỏi cả IndexedDB và Supabase PostgreSQL
 */
export async function deleteSurveyRecord(id) {
  await deleteFromIndexedDB(id);
  if (isSupabaseConfigured && navigator.onLine) {
    try {
      await supabase.from('surveys').delete().eq('id', id);
      console.log('[Supabase] Đã xóa bản ghi khỏi PostgreSQL:', id);
    } catch (err) {
      console.warn('[Supabase] Không thể xóa từ server:', err);
    }
  }
}

