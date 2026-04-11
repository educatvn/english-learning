import { gas } from './googleSheets'
import type { StudyPlan, DailyProgress } from '@/types'

// ── Plans CRUD ──────────────────────────────────────────────────────────────

export async function getPlans(userId: string): Promise<StudyPlan[]> {
  return gas<StudyPlan[]>('getPlans', { userId })
}

export async function upsertPlan(plan: StudyPlan): Promise<void> {
  await gas('upsertPlan', plan)
}

export async function deletePlan(id: string, userId: string): Promise<void> {
  await gas('deletePlan', { id, userId })
}

export async function activatePlan(id: string, userId: string, startDate?: string): Promise<void> {
  await gas('activatePlan', { id, userId, startDate })
}

export async function pausePlan(id: string, userId: string): Promise<void> {
  await gas('pausePlan', { id, userId })
}

// ── Daily progress ──────────────────────────────────────────────────────────

export async function getDailyProgress(
  userId: string,
  planId: string,
): Promise<DailyProgress[]> {
  return gas<DailyProgress[]>('getPlanDailyProgress', { userId, planId })
}

export async function getAllDailyProgress(
  userId: string,
): Promise<DailyProgress[]> {
  return gas<DailyProgress[]>('getAllPlanDailyProgress', { userId })
}

export async function togglePlanItem(
  userId: string,
  planId: string,
  date: string,
  itemId: string,
): Promise<DailyProgress> {
  return gas<DailyProgress>('togglePlanItem', { userId, planId, date, itemId })
}
