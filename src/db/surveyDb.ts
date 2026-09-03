import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SurveyDraft, SurveyRecord, SyncStatus } from '../types/survey';

interface VKUSurveyDB extends DBSchema {
  drafts: {
    key: string;
    value: SurveyDraft;
  };
  surveys: {
    key: string;
    value: SurveyRecord;
    indexes: {
      'by-status': SyncStatus;
      'by-created': number;
    };
  };
}

const DB_NAME = 'vku_field_survey_db';
const DB_VERSION = 1;
const DRAFT_KEY = 'current_active_draft';

let dbPromise: Promise<IDBPDatabase<VKUSurveyDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<VKUSurveyDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VKUSurveyDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Store lưu nháp form hiện thời
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts');
        }
        // Store lưu danh sách các khảo sát và hàng chờ đồng bộ
        if (!db.objectStoreNames.contains('surveys')) {
          const surveyStore = db.createObjectStore('surveys', { keyPath: 'id' });
          surveyStore.createIndex('by-status', 'status');
          surveyStore.createIndex('by-created', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

// === Quản lý bản nháp (Drafts) ===

export async function getDraft(): Promise<SurveyDraft | undefined> {
  const db = await getDB();
  return db.get('drafts', DRAFT_KEY);
}

export async function saveDraft(draft: SurveyDraft): Promise<void> {
  const db = await getDB();
  await db.put('drafts', draft, DRAFT_KEY);
}

export async function clearDraft(): Promise<void> {
  const db = await getDB();
  await db.delete('drafts', DRAFT_KEY);
}

// === Quản lý khảo sát & Hàng chờ đồng bộ (Sync Queue) ===

export async function saveSurvey(survey: SurveyRecord): Promise<void> {
  const db = await getDB();
  await db.put('surveys', survey);
}

export async function getSurvey(id: string): Promise<SurveyRecord | undefined> {
  const db = await getDB();
  return db.get('surveys', id);
}

export async function getAllSurveys(): Promise<SurveyRecord[]> {
  const db = await getDB();
  const list = await db.getAllFromIndex('surveys', 'by-created');
  // Sắp xếp bản mới nhất lên đầu
  return list.reverse();
}

export async function getPendingSurveys(): Promise<SurveyRecord[]> {
  const db = await getDB();
  const pending = await db.getAllFromIndex('surveys', 'by-status', 'PENDING_SYNC');
  const failed = await db.getAllFromIndex('surveys', 'by-status', 'FAILED');
  // Sắp xếp thứ tự thời gian tăng dần để đồng bộ tuần tự
  const combined = [...pending, ...failed];
  return combined.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateSurveyStatus(
  id: string,
  status: SyncStatus,
  error?: string
): Promise<void> {
  const db = await getDB();
  const record = await db.get('surveys', id);
  if (record) {
    record.status = status;
    if (status === 'SYNCED') {
      record.syncedAt = Date.now();
      delete record.syncError;
    } else if (status === 'FAILED') {
      record.syncError = error || 'Lỗi mạng hoặc máy chủ không phản hồi';
    }
    await db.put('surveys', record);
  }
}

export async function deleteSurvey(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('surveys', id);
}

