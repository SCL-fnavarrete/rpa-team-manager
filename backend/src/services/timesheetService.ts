import { startOfWeek, addDays, format, parseISO } from 'date-fns';
import { db } from '../database/database';
import { logger } from '../utils/logger';
import { financeService, Currency } from './financeService';
import { notificationService } from './notificationService';

export interface TimeEntryRow {
    id: number;
    project_id: number;
    project_name: string;
    task_id: number | null;
    task_title: string | null;
    description: string | null;
    hours: number;
    date: string;
    is_billable: boolean;
    approval_status: 'draft' | 'submitted' | 'approved' | 'rejected';
    is_locked: boolean;
}

export interface TimesheetWeekDay {
    date: string;
    entries: TimeEntryRow[];
    total_hours: number;
}

export interface TimesheetPeriodRow {
    id: number;
    user_id: number;
    period_start: string;
    period_end: string;
    status: 'open' | 'submitted' | 'approved' | 'rejected';
    submitted_at: string | null;
    approved_by: number | null;
    approved_at: string | null;
    rejection_reason: string | null;
}

export interface TimesheetWeek {
    period: TimesheetPeriodRow | null;
    days: TimesheetWeekDay[];
    total_hours: number;
}

export interface SaveWeekEntryInput {
    id?: number;
    project_id: number;
    task_id?: number | null;
    description?: string | null;
    date: string;
    hours: number;
    is_billable?: boolean;
}

export interface EffectivenessByPerson {
    user_id: number;
    user_name: string;
    estimated_hours: number;
    real_hours: number;
    utilization_pct: number;
    billable_pct: number;
}

export interface EffectivenessByTask {
    task_id: number;
    task_title: string;
    project_name: string;
    estimated_hours: number;
    real_hours: number;
    variance_hours: number;
}

export interface EffectivenessMetrics {
    from: string;
    to: string;
    by_person: EffectivenessByPerson[];
    by_task: EffectivenessByTask[];
}

function toRow(raw: any): TimeEntryRow {
    return {
        id: raw.id,
        project_id: raw.project_id,
        project_name: raw.project_name,
        task_id: raw.task_id,
        task_title: raw.task_title,
        description: raw.description,
        hours: raw.hours,
        date: raw.date,
        is_billable: !!raw.is_billable,
        approval_status: raw.approval_status,
        is_locked: !!raw.is_locked
    };
}

/**
 * Grilla semanal de horas: única fuente para leer/escribir la semana de un usuario.
 * time_entries sigue siendo la tabla de datos; este servicio agrega por semana,
 * gestiona el ciclo de vida de timesheet_periods (Task 3) y las métricas derivadas (Task 5/6).
 */
export class TimesheetService {
    /** Lunes (yyyy-MM-dd) de la semana que contiene anyDateInWeek. */
    getWeekStart(anyDateInWeek: string): string {
        const monday = startOfWeek(parseISO(anyDateInWeek), { weekStartsOn: 1 });
        return format(monday, 'yyyy-MM-dd');
    }

    private getWeekEnd(weekStartDate: string): string {
        return format(addDays(parseISO(weekStartDate), 6), 'yyyy-MM-dd');
    }

    async getPeriod(userId: number, weekStartDate: string): Promise<TimesheetPeriodRow | null> {
        const row = await db.get(
            `SELECT * FROM timesheet_periods WHERE user_id = ? AND period_start = ?`,
            [userId, weekStartDate]
        );
        return row || null;
    }

    /** True si `date` cae dentro de un timesheet_period de este usuario ya enviado o aprobado. */
    async isDateLocked(userId: number, date: string): Promise<boolean> {
        const period = await db.get(
            `SELECT id FROM timesheet_periods
             WHERE user_id = ? AND period_start <= ? AND period_end >= ? AND status IN ('submitted', 'approved')`,
            [userId, date, date]
        );
        return !!period;
    }

    async getWeek(userId: number, weekStartDate: string): Promise<TimesheetWeek> {
        const monday = this.getWeekStart(weekStartDate);
        const sunday = this.getWeekEnd(monday);

        const [period, rawRows] = await Promise.all([
            this.getPeriod(userId, monday),
            db.query(
                `SELECT te.id, te.project_id, p.name as project_name, te.task_id, t.title as task_title,
                        te.description, te.hours, te.date, te.is_billable, te.approval_status, te.is_locked
                 FROM time_entries te
                 JOIN projects p ON p.id = te.project_id
                 LEFT JOIN tasks t ON t.id = te.task_id
                 WHERE te.user_id = ? AND te.date >= ? AND te.date <= ?
                 ORDER BY te.date ASC, te.created_at ASC`,
                [userId, monday, sunday]
            )
        ]);

        const rows = rawRows.map(toRow);
        const days: TimesheetWeekDay[] = [];
        let totalHours = 0;

        for (let i = 0; i < 7; i++) {
            const date = format(addDays(parseISO(monday), i), 'yyyy-MM-dd');
            const entries = rows.filter(r => r.date === date);
            const dayTotal = entries.reduce((sum, e) => sum + e.hours, 0);
            totalHours += dayTotal;
            days.push({ date, entries, total_hours: dayTotal });
        }

        return { period, days, total_hours: totalHours };
    }

    /**
     * Reemplaza el conjunto de entradas de la semana por el payload recibido (semántica de
     * "estado completo de la semana", igual que la grilla lo edita en el frontend): lo que
     * ya existía y no viene en el payload se borra, lo que trae `id` se actualiza, el resto se inserta.
     * Crea el timesheet_period en 'open' si es la primera vez que se guarda algo en esa semana.
     */
    async saveWeekEntries(userId: number, weekStartDate: string, entries: SaveWeekEntryInput[]): Promise<TimesheetWeek> {
        const monday = this.getWeekStart(weekStartDate);
        const sunday = this.getWeekEnd(monday);

        const existingPeriod = await this.getPeriod(userId, monday);
        if (existingPeriod && (existingPeriod.status === 'submitted' || existingPeriod.status === 'approved')) {
            throw new Error(`Timesheet week is locked (status=${existingPeriod.status})`);
        }

        await db.beginTransaction();
        try {
            for (const entry of entries) {
                if (entry.date < monday || entry.date > sunday) {
                    throw new Error(`Entry date ${entry.date} is outside the week being saved (${monday}..${sunday})`);
                }
            }

            let periodId = existingPeriod?.id;
            if (!periodId) {
                const created = await db.run(
                    `INSERT INTO timesheet_periods (user_id, period_start, period_end, status) VALUES (?, ?, ?, 'open')`,
                    [userId, monday, sunday]
                );
                periodId = created.id!;
            } else if (existingPeriod!.status === 'rejected') {
                await db.run(`UPDATE timesheet_periods SET status = 'open', rejection_reason = NULL WHERE id = ?`, [periodId]);
            }

            // Un timer en curso (start_time sin end_time) no es representable en la grilla, así que
            // nunca puede venir en el payload: excluirlo aquí evita que el barrido lo borre.
            const existingIdsRows = await db.query(
                `SELECT id FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ?
                 AND NOT (start_time IS NOT NULL AND end_time IS NULL)`,
                [userId, monday, sunday]
            );
            const existingIds = new Set(existingIdsRows.map((r: any) => r.id));
            const keptIds = new Set(entries.filter(e => e.id).map(e => e.id));

            for (const id of existingIds) {
                if (!keptIds.has(id)) {
                    const deleted = await db.run(`DELETE FROM time_entries WHERE id = ? AND is_locked = 0`, [id]);
                    if (deleted.changes !== 1) {
                        throw new Error(`Time entry ${id} could not be deleted (locked or already gone)`);
                    }
                }
            }

            for (const entry of entries) {
                if (entry.id) {
                    const updateResult = await db.run(
                        `UPDATE time_entries
                         SET project_id = ?, task_id = ?, description = ?, hours = ?, date = ?,
                             is_billable = ?, timesheet_period_id = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ? AND user_id = ? AND is_locked = 0 AND date >= ? AND date <= ?`,
                        [
                            entry.project_id, entry.task_id ?? null, entry.description ?? null, entry.hours, entry.date,
                            entry.is_billable === false ? 0 : 1, periodId, entry.id, userId, monday, sunday
                        ]
                    );
                    if (updateResult.changes !== 1) {
                        throw new Error(`Time entry ${entry.id} could not be updated (not found, not owned by this user, locked, or outside this week)`);
                    }
                } else {
                    await db.run(
                        `INSERT INTO time_entries (
                            user_id, project_id, task_id, description, hours, date, is_billable,
                            approval_status, timesheet_period_id, created_at, updated_at
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                        [
                            userId, entry.project_id, entry.task_id ?? null, entry.description ?? null,
                            entry.hours, entry.date, entry.is_billable === false ? 0 : 1, periodId
                        ]
                    );
                }
            }

            await db.commit();
        } catch (error) {
            await db.rollback();
            logger.error('saveWeekEntries failed, rolled back:', error);
            throw error;
        }

        return this.getWeek(userId, monday);
    }

    async submitWeek(userId: number, weekStartDate: string): Promise<TimesheetPeriodRow> {
        const monday = this.getWeekStart(weekStartDate);
        const sunday = this.getWeekEnd(monday);
        const period = await this.getPeriod(userId, monday);

        if (!period) {
            throw new Error('No timesheet period found for that week (nothing was saved yet)');
        }
        if (period.status === 'approved') {
            throw new Error('This week was already approved and cannot be re-submitted');
        }

        // Las entradas creadas fuera de la grilla (timer, POST /api/time-entries) no tienen periodo:
        // se adoptan por fecha+usuario antes de marcar, para que aprobar la semana las congele a todas.
        await db.run(
            `UPDATE time_entries SET timesheet_period_id = ?
             WHERE user_id = ? AND date >= ? AND date <= ? AND timesheet_period_id IS NULL AND is_locked = 0`,
            [period.id, userId, monday, sunday]
        );

        await db.run(
            `UPDATE timesheet_periods SET status = 'submitted', submitted_at = datetime('now'), rejection_reason = NULL WHERE id = ?`,
            [period.id]
        );
        await db.run(
            `UPDATE time_entries SET approval_status = 'submitted' WHERE timesheet_period_id = ?`,
            [period.id]
        );

        const teamLeads = await db.query(`SELECT id FROM users WHERE role = 'team_lead' AND is_active = 1`, []);
        for (const teamLead of teamLeads) {
            await notificationService.notify({
                userId: teamLead.id,
                eventKey: 'timesheet_submitted',
                title: 'Un timesheet fue enviado para aprobación',
                message: `Semana del ${monday}`,
                entityType: 'timesheet_period',
                entityId: period.id,
                senderId: userId,
                link: '/time?tab=approvals'
            });
        }

        logger.info(`Timesheet: usuario ${userId} envió la semana del ${monday} para aprobación`);
        return { ...period, status: 'submitted' };
    }

    async getPendingApprovals(): Promise<Array<TimesheetPeriodRow & { user_name: string; total_hours: number; entries: TimeEntryRow[] }>> {
        const periods = await db.query(
            `SELECT tp.*, u.full_name as user_name,
                    COALESCE((SELECT SUM(hours) FROM time_entries WHERE timesheet_period_id = tp.id), 0) as total_hours
             FROM timesheet_periods tp
             JOIN users u ON u.id = tp.user_id
             WHERE tp.status = 'submitted'
             ORDER BY tp.submitted_at ASC`
        );
        if (!periods.length) return [];

        const periodIds = periods.map((p: any) => p.id);
        const placeholders = periodIds.map(() => '?').join(',');
        const rawEntries = await db.query(
            `SELECT te.id, te.timesheet_period_id, te.project_id, p.name as project_name, te.task_id, t.title as task_title,
                    te.description, te.hours, te.date, te.is_billable, te.approval_status, te.is_locked
             FROM time_entries te
             JOIN projects p ON p.id = te.project_id
             LEFT JOIN tasks t ON t.id = te.task_id
             WHERE te.timesheet_period_id IN (${placeholders})
             ORDER BY te.date ASC, te.created_at ASC`,
            periodIds
        );

        const entriesByPeriod = new Map<number, TimeEntryRow[]>();
        for (const raw of rawEntries) {
            const list = entriesByPeriod.get(raw.timesheet_period_id) || [];
            list.push(toRow(raw));
            entriesByPeriod.set(raw.timesheet_period_id, list);
        }

        return periods.map((p: any) => ({
            ...p,
            entries: entriesByPeriod.get(p.id) || []
        }));
    }

    private async getUserCostRateCLP(userId: number): Promise<number> {
        const rate = await db.get(
            `SELECT hourly_rate, hourly_rate_currency FROM user_cost_rates
             WHERE user_id = ? AND is_active = 1 ORDER BY effective_from DESC LIMIT 1`,
            [userId]
        );
        if (!rate) return 0;
        return financeService.toCLP(rate.hourly_rate, rate.hourly_rate_currency as Currency);
    }

    private async getProjectBillRateCLP(projectId: number): Promise<number> {
        const financials = await db.get(
            `SELECT hourly_rate, hourly_rate_currency FROM project_financials WHERE project_id = ?`,
            [projectId]
        );
        if (!financials?.hourly_rate) return 0;
        return financeService.toCLP(financials.hourly_rate, (financials.hourly_rate_currency as Currency) || 'UF');
    }

    /**
     * Aprueba una semana: congela cost_rate_snapshot/bill_rate_snapshot (siempre en CLP, al valor
     * vigente hoy) por cada entrada y las bloquea (is_locked=1). Desde este momento financeService
     * usa estas horas como real_hours/real_cost del proyecto (ver Task 4) - por eso el snapshot
     * se congela aquí y no se recalcula nunca más, ni si cambia la tarifa del usuario a futuro.
     * Toda la operación es transaccional (all-or-nothing).
     */
    async approveWeek(approverId: number, periodId: number): Promise<TimesheetPeriodRow> {
        const period = await db.get(`SELECT * FROM timesheet_periods WHERE id = ?`, [periodId]);
        if (!period) {
            throw new Error(`Timesheet period ${periodId} not found`);
        }
        if (period.status !== 'submitted') {
            throw new Error(`Timesheet period ${periodId} is not submitted (status=${period.status})`);
        }

        const userCostRateCLP = await this.getUserCostRateCLP(period.user_id);
        // Congelar un 0 es irreversible (el snapshot no se recalcula nunca) y colapsaría el costo
        // real del proyecto para siempre: preferimos bloquear la aprobación.
        if (userCostRateCLP <= 0) {
            throw new Error(`User ${period.user_id} has no active cost rate configured; configure it before approving this week`);
        }

        const entries = await db.query(
            `SELECT id, project_id, hours, is_billable FROM time_entries WHERE timesheet_period_id = ?`,
            [periodId]
        );

        await db.beginTransaction();
        try {
            for (const entry of entries) {
                const billRateCLP = entry.is_billable ? await this.getProjectBillRateCLP(entry.project_id) : 0;
                await db.run(
                    `UPDATE time_entries
                     SET approval_status = 'approved', is_locked = 1, approved_by = ?, approved_at = datetime('now'),
                         cost_rate_snapshot = ?, bill_rate_snapshot = ?
                     WHERE id = ?`,
                    [approverId, userCostRateCLP, billRateCLP, entry.id]
                );
            }

            await db.run(
                `UPDATE timesheet_periods SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
                [approverId, periodId]
            );

            await db.commit();
        } catch (error) {
            await db.rollback();
            logger.error('approveWeek failed, rolled back:', error);
            throw error;
        }

        logger.info(`Timesheet: periodo ${periodId} (usuario ${period.user_id}) aprobado por ${approverId} - ${entries.length} entrada(s) bloqueada(s)`);
        return { ...period, status: 'approved', approved_by: approverId };
    }

    async rejectWeek(approverId: number, periodId: number, reason: string): Promise<TimesheetPeriodRow> {
        const period = await db.get(`SELECT * FROM timesheet_periods WHERE id = ?`, [periodId]);
        if (!period) {
            throw new Error(`Timesheet period ${periodId} not found`);
        }
        if (period.status !== 'submitted') {
            throw new Error(`Timesheet period ${periodId} cannot be rejected (status=${period.status})`);
        }

        await db.run(
            `UPDATE timesheet_periods SET status = 'rejected', rejection_reason = ?, approved_by = ? WHERE id = ?`,
            [reason, approverId, periodId]
        );
        await db.run(`UPDATE time_entries SET approval_status = 'rejected' WHERE timesheet_period_id = ?`, [periodId]);

        logger.info(`Timesheet: periodo ${periodId} (usuario ${period.user_id}) rechazado por ${approverId}: ${reason}`);
        return { ...period, status: 'rejected', rejection_reason: reason };
    }

    /**
     * Estimado vs. real por persona y por tarea, en un rango de fechas. Solo cuenta horas
     * aprobadas (bloqueadas) - es el dato confiable que da nombre a esta fase.
     */
    async getEffectivenessMetrics(from: string, to: string): Promise<EffectivenessMetrics> {
        const monthlyHours = await financeService.getMonthlyHours();
        const daysInRange = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
        const expectedHours = monthlyHours * (daysInRange / 30);

        const realByPerson = await db.query(
            `SELECT te.user_id, u.full_name as user_name,
                    COALESCE(SUM(te.hours), 0) as real_hours,
                    COALESCE(SUM(CASE WHEN te.is_billable = 1 THEN te.hours ELSE 0 END), 0) as billable_hours
             FROM time_entries te
             JOIN users u ON u.id = te.user_id
             WHERE te.approval_status = 'approved' AND te.date >= ? AND te.date <= ?
             GROUP BY te.user_id, u.full_name`,
            [from, to]
        );

        const estimatedByPerson = await db.query(
            `SELECT ta.user_id as user_id, COALESCE(SUM(t.estimated_hours), 0) as estimated_hours
             FROM task_assignees ta
             JOIN tasks t ON t.id = ta.task_id
             GROUP BY ta.user_id`
        );
        const estimatedMap = new Map<number, number>(estimatedByPerson.map((r: any) => [r.user_id, r.estimated_hours]));

        const by_person: EffectivenessByPerson[] = realByPerson.map((r: any) => ({
            user_id: r.user_id,
            user_name: r.user_name,
            estimated_hours: estimatedMap.get(r.user_id) || 0,
            real_hours: r.real_hours,
            utilization_pct: Math.round((r.real_hours / expectedHours) * 1000) / 10,
            billable_pct: r.real_hours > 0 ? Math.round((r.billable_hours / r.real_hours) * 1000) / 10 : 0
        }));

        const byTaskRows = await db.query(
            `SELECT t.id as task_id, t.title as task_title, p.name as project_name,
                    COALESCE(t.estimated_hours, 0) as estimated_hours,
                    COALESCE(SUM(te.hours), 0) as real_hours
             FROM tasks t
             JOIN task_boards b ON b.id = t.board_id
             JOIN projects p ON p.id = b.project_id
             LEFT JOIN time_entries te ON te.task_id = t.id
                AND te.approval_status = 'approved' AND te.date >= ? AND te.date <= ?
             WHERE t.estimated_hours IS NOT NULL
             GROUP BY t.id, t.title, p.name, t.estimated_hours`,
            [from, to]
        );

        const by_task: EffectivenessByTask[] = byTaskRows.map((r: any) => ({
            task_id: r.task_id,
            task_title: r.task_title,
            project_name: r.project_name,
            estimated_hours: r.estimated_hours,
            real_hours: r.real_hours,
            variance_hours: Math.round((r.real_hours - r.estimated_hours) * 100) / 100
        }));

        return { from, to, by_person, by_task };
    }

    /** Días hábiles (lunes a viernes) de las últimas dos semanas sin ninguna entrada de tiempo. */
    async getPendingReminders(userId: number, referenceDate?: string): Promise<{ missing_dates: string[]; open_period: TimesheetPeriodRow | null }> {
        const today = referenceDate ? parseISO(referenceDate) : new Date();
        const from = format(addDays(today, -13), 'yyyy-MM-dd');
        const to = format(today, 'yyyy-MM-dd');

        const rows = await db.query(
            `SELECT DISTINCT date FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ?`,
            [userId, from, to]
        );
        const datesWithEntries = new Set(rows.map((r: any) => r.date));

        const missing_dates: string[] = [];
        for (let i = 0; i < 14; i++) {
            const date = addDays(parseISO(from), i);
            const dayOfWeek = date.getDay(); // 0 domingo, 6 sábado
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;
            const dateStr = format(date, 'yyyy-MM-dd');
            if (!datesWithEntries.has(dateStr)) {
                missing_dates.push(dateStr);
            }
        }

        const openPeriod = await db.get(
            `SELECT * FROM timesheet_periods WHERE user_id = ? AND status IN ('open', 'rejected') ORDER BY period_start DESC LIMIT 1`,
            [userId]
        );

        return { missing_dates, open_period: openPeriod || null };
    }

    /**
     * Sin scheduler en este proyecto: se llama una vez al arrancar el servidor (server.ts) para
     * dejar en el log quién tiene trabajo pendiente, igual que describe la Fase 3 del plan maestro.
     * No envía notificaciones (eso es Fase 5, cuando se active socket.io/notifications).
     */
    async logStartupPendingWorkSummary(): Promise<void> {
        const users = await db.query(`SELECT id, full_name FROM users WHERE is_active = 1`);

        for (const user of users) {
            const { missing_dates } = await this.getPendingReminders(user.id);
            if (missing_dates.length > 0) {
                logger.info(`Timesheet: ${user.full_name} tiene ${missing_dates.length} día(s) hábil(es) sin horas registradas en las últimas 2 semanas`);
            }
        }
    }
}

export const timesheetService = new TimesheetService();
