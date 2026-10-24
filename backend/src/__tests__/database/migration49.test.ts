import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MigrationManager } from '../../database/migrations';
import { migrations } from '../../database/migrationList';

describe('Migración 49 - proyectos en ejecución sin aprobación comercial pasan a approved', () => {
    let dbPath: string;

    const open = (): Promise<sqlite3.Database> =>
        new Promise((resolve, reject) => {
            const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
        });

    const close = (conn: sqlite3.Database): Promise<void> => new Promise((resolve) => conn.close(() => resolve()));

    const all = (conn: sqlite3.Database, sql: string, params: any[] = []): Promise<any[]> =>
        new Promise((resolve, reject) => conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

    const run = (conn: sqlite3.Database, sql: string, params: any[] = []): Promise<void> =>
        new Promise((resolve, reject) => conn.run(sql, params, (err) => (err ? reject(err) : resolve())));

    const migrate = async (upTo?: number) => {
        const manager = new MigrationManager();
        await manager.init(dbPath);
        await manager.runMigrations(upTo ? migrations.filter((m) => m.version <= upTo) : migrations);
        await manager.close();
    };

    const insertProject = (
        conn: sqlite3.Database,
        name: string,
        status: string,
        extra: { commercial_stage?: string; client_approved_at?: string | null; created_at: string }
    ) =>
        run(
            conn,
            `INSERT INTO projects (name, status, commercial_stage, client_approved_at, created_at) VALUES (?, ?, ?, ?, ?)`,
            [name, status, extra.commercial_stage ?? 'quoting', extra.client_approved_at ?? null, extra.created_at]
        );

    beforeAll(() => {
        dbPath = path.join(os.tmpdir(), `migration49-approved-stage-test-${Date.now()}.sqlite`);
    });

    afterAll(() => {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });

    it('pasa a approved los proyectos quoting con status active o completed, conserva client_approved_at existente y NO toca los quoting en on_hold, planning ni cancelled', async () => {
        await migrate(48);

        const before = await open();
        await insertProject(before, 'Activo sin etapa', 'active', { created_at: '2026-03-10 09:00:00' });
        await insertProject(before, 'Completado sin etapa', 'completed', { created_at: '2026-02-01 08:30:00' });
        await insertProject(before, 'Activo con aprobación previa', 'active', {
            client_approved_at: '2026-04-02 12:00:00',
            created_at: '2026-03-01 00:00:00'
        });
        await insertProject(before, 'Oportunidad en pausa', 'on_hold', { created_at: '2026-05-01 10:00:00' });
        await insertProject(before, 'Oportunidad cancelada', 'cancelled', { created_at: '2026-05-02 10:00:00' });
        await insertProject(before, 'Perdido pese a activo', 'active', {
            commercial_stage: 'lost',
            created_at: '2026-05-03 10:00:00'
        });
        await insertProject(before, 'Ya aprobado sin fecha', 'active', {
            commercial_stage: 'approved',
            created_at: '2026-05-04 10:00:00'
        });

        const stagesBefore = await all(before, `SELECT name, commercial_stage FROM projects WHERE name IN ('Activo sin etapa', 'Completado sin etapa')`);
        await close(before);
        expect(stagesBefore.map((r) => r.commercial_stage)).toEqual(['quoting', 'quoting']);

        await migrate();

        const after = await open();
        try {
            const applied = (await all(after, 'SELECT version FROM schema_migrations')).map((r) => r.version);
            const rows = await all(after, `SELECT name, status, commercial_stage, client_approved_at FROM projects ORDER BY id`);
            const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

            expect(applied).toContain(49);
            expect(byName['Activo sin etapa']).toMatchObject({ commercial_stage: 'approved', client_approved_at: '2026-03-10 09:00:00' });
            expect(byName['Completado sin etapa']).toMatchObject({ commercial_stage: 'approved', client_approved_at: '2026-02-01 08:30:00' });
            expect(byName['Activo con aprobación previa']).toMatchObject({ commercial_stage: 'approved', client_approved_at: '2026-04-02 12:00:00' });
            expect(byName['Oportunidad en pausa']).toMatchObject({ commercial_stage: 'quoting', client_approved_at: null });
            expect(byName['Oportunidad cancelada']).toMatchObject({ commercial_stage: 'quoting', client_approved_at: null });
            expect(byName['Perdido pese a activo']).toMatchObject({ commercial_stage: 'lost', client_approved_at: null });
            expect(byName['Ya aprobado sin fecha']).toMatchObject({ commercial_stage: 'approved', client_approved_at: null });
        } finally {
            await close(after);
        }
    });
});
