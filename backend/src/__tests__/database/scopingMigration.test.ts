import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MigrationManager } from '../../database/migrations';
import { migrations } from '../../database/migrationList';

describe('Migración 47 - Cotizador RPA (scoping_quotations)', () => {
    let dbPath: string;
    let db: sqlite3.Database;

    function run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (this: any, err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    function all(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
        });
    }

    // Una fila válida mínima: todas las columnas NOT NULL sin default.
    const validRow = (code: string, status = 'draft') => ({
        code,
        client_name: 'Cliente Demo',
        process_name: 'Contabilización de facturas',
        data_input_type: 'digital_structured',
        rule_based_level: 'rules_mostly',
        process_stability: 'no_change',
        application_stability: 'no_change',
        frequency: 'daily',
        process_steps_count: '15_25',
        decision_complexity: 'simple_yes_no',
        applications_count: '2_3_apps',
        structured_data_pct: 'gte_80',
        viability_status: 'viable',
        viability_score: 8.5,
        complexity_score: 3.2,
        difficulty_score: 4.1,
        effort_level: 'medium',
        benefit_level: 'high',
        annual_manual_hours: 1200,
        hours_saved_annual: 1000,
        ftes_released: 0.6,
        error_reduction_pct: 90,
        aht_reduction_pct: 80,
        project_internal_cost: 4000000,
        proposed_price: 8000000,
        projected_margin_pct: 50,
        client_annual_manual_cost: 16000000,
        client_annual_savings: 13000000,
        payback_months: 7.4,
        roi_first_year_pct: 62.5,
        status
    });

    function insert(row: Record<string, any>) {
        const cols = Object.keys(row);
        return run(
            `INSERT INTO scoping_quotations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map((c) => row[c])
        );
    }

    beforeAll(async () => {
        dbPath = path.join(os.tmpdir(), `migration47-scoping-test-${Date.now()}.sqlite`);
        const manager = new MigrationManager();
        await manager.init(dbPath);
        await manager.runMigrations(migrations);
        await manager.close();

        db = await new Promise((resolve, reject) => {
            const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
        });
        await run('PRAGMA foreign_keys = ON');
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => db.close(() => resolve()));
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });

    it('crea la tabla con las columnas de entrada, resultado, cubicación y economía', async () => {
        const cols = (await all('PRAGMA table_info(scoping_quotations)')).map((r) => r.name);

        expect(cols).toEqual(
            expect.arrayContaining([
                'id', 'code', 'client_name', 'process_name', 'process_archetype',
                'data_input_type', 'frequency', 'uses_vdi', 'requires_ocr',
                'viability_status', 'effort_level', 'annual_manual_hours',
                'estimated_weeks', 'hours_pm', 'hours_consultant', 'hours_developer', 'hours_advisor', 'total_hours',
                'proposed_price', 'projected_margin_pct', 'payback_months', 'roi_first_year_pct',
                'status', 'converted_project_id'
            ])
        );
    });

    it('crea los 4 índices esperados', async () => {
        const idx = (await all(`PRAGMA index_list(scoping_quotations)`)).map((r) => r.name);

        expect(idx).toEqual(
            expect.arrayContaining([
                'idx_scoping_client',
                'idx_scoping_status',
                'idx_scoping_archetype',
                'idx_scoping_created'
            ])
        );
    });

    it('aplica los defaults: estado borrador, arquetipo custom, CLP y horas base', async () => {
        await insert(validRow('COT-DEFAULTS'));

        const [row] = await all(`SELECT * FROM scoping_quotations WHERE code = 'COT-DEFAULTS'`);

        expect(row.status).toBe('draft');
        expect(row.process_archetype).toBe('custom');
        expect(row.currency).toBe('CLP');
        expect(row.estimated_weeks).toBe(6);
        expect(row.total_hours).toBe(236);
        expect(row.converted_project_id).toBeNull();
    });

    it('rechaza un código duplicado', async () => {
        await insert(validRow('COT-DUP'));

        await expect(insert(validRow('COT-DUP'))).rejects.toThrow(/UNIQUE/i);
    });

    it('rechaza un status fuera del CHECK', async () => {
        await expect(insert(validRow('COT-BAD-STATUS', 'archivado'))).rejects.toThrow(/CHECK/i);
    });

    it('acepta los 5 estados válidos', async () => {
        const states = ['draft', 'sent_to_client', 'approved', 'rejected', 'converted_to_project'];
        for (const status of states) {
            await insert(validRow(`COT-OK-${status}`, status));
        }

        const rows = await all(`SELECT status FROM scoping_quotations WHERE code LIKE 'COT-OK-%'`);
        expect(rows.map((r) => r.status).sort()).toEqual([...states].sort());
    });

    it('al borrar el usuario creador queda created_by en NULL (no borra la cotización)', async () => {
        const user = await run(
            `INSERT INTO users (username, email, password_hash, full_name, role) VALUES ('scoper', 'scoper@test.cl', 'x', 'Scoper Test', 'rpa_developer')`
        );
        await insert({ ...validRow('COT-USER'), created_by: user.lastID });

        // Las migraciones dejan global_settings.updated_by apuntando al último usuario insertado.
        await run('UPDATE global_settings SET updated_by = NULL WHERE updated_by = ?', [user.lastID]);
        await run('DELETE FROM users WHERE id = ?', [user.lastID]);

        const [row] = await all(`SELECT created_by FROM scoping_quotations WHERE code = 'COT-USER'`);
        expect(row.created_by).toBeNull();
    });
});
