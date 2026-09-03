import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Kiểm tra xem người dùng đã cấu hình URL và API Key thực tế chưa
export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project-ref') &&
  !supabaseUrl.includes('xyzcompany')
);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY hợp lệ trong file .env. Dữ liệu sẽ lưu trữ vào IndexedDB offline và tự động đồng bộ khi bạn cấu hình Supabase.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

