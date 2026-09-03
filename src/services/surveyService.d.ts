import type { SurveyDraft, SurveyRecord } from '../types/survey';

export function saveSurvey(surveyData: SurveyDraft | SurveyRecord): Promise<SurveyRecord>;
export function fetchSurveys(): Promise<SurveyRecord[]>;
export function subscribeSurveys(callback: (surveys: SurveyRecord[]) => void): () => void;
export function syncPendingToSupabase(): Promise<{ synced: number; failed: number }>;
export function deleteSurveyRecord(id: string): Promise<void>;
z