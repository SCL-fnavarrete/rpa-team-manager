import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../database/database';
import { logger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import multer from 'multer';
import fs from 'fs';
import { selectWritableColumns } from '../utils/columnWhitelist';

/**
 * Columnas de support_tickets que un cliente puede escribir con PUT /support/tickets/:id. id, id_ticket,
 * created_by, created_at, resolved_at y updated_at las fija el servidor; id_ticket es la clave de la ruta y se
 * descarta sin error porque el formulario la envía junto al resto.
 */
const SUPPORT_TICKET_UPDATABLE_COLUMNS = [
    'company_id', 'title', 'description', 'priority', 'status', 'ticket_type', 'resolver_id', 'hours_spent',
    'attention_method', 'rpa_process_id', 'contact_id', 'work_date', 'completion_date'
] as const;
const SUPPORT_TICKET_IGNORED_KEYS = ['id_ticket'] as const;

export class SupportController {

    private spreadsheetValue(value: ExcelJS.CellValue): unknown {
        if (value && typeof value === 'object') {
            if ('result' in value) return value.result;
            if ('text' in value) return value.text;
            if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
        }
        return value ?? '';
    }

    private async readSpreadsheet(filePath: string, mimeType: string): Promise<{ headers: string[]; rows: unknown[][]; records: Record<string, unknown>[] }> {
        const workbook = new ExcelJS.Workbook();
        if (mimeType === 'text/csv') await workbook.csv.readFile(filePath);
        else await workbook.xlsx.readFile(filePath);

        const worksheet = workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount === 0) return { headers: [], rows: [], records: [] };

        const headers = ((worksheet.getRow(1).values as ExcelJS.CellValue[]) || [])
            .slice(1)
            .map(value => String(this.spreadsheetValue(value)).trim());
        const rows: unknown[][] = [];
        const records: Record<string, unknown>[] = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const values = ((row.values as ExcelJS.CellValue[]) || []).slice(1).map(value => this.spreadsheetValue(value));
            if (!values.some(value => value !== '' && value !== null && value !== undefined)) return;
            rows.push(values);
            records.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
        });

        return { headers, rows, records };
    }

    // Helper function to get UF to CLP conversion rate
    private getUFToCLPRate = async (): Promise<number> => {
        try {
            const setting = await db.get('SELECT setting_value FROM global_settings WHERE setting_key = ?', ['uf_to_clp']);
            return setting ? parseFloat(setting.setting_value) : 35000; // Default fallback
        } catch (error) {
            logger.warn('Could not get UF to CLP rate, using default:', error);
            return 35000; // Default UF rate
        }
    };

    // Helper function to convert currency to CLP
    private convertToCLP = async (amount: number, currency: string): Promise<number> => {
        if (currency === 'CLP') {
            return amount;
        } else if (currency === 'UF') {
            const ufRate = await this.getUFToCLPRate();
            return amount * ufRate;
        } else if (currency === 'USD') {
            const usdSetting = await db.get('SELECT setting_value FROM global_settings WHERE setting_key = ?', ['usd_to_clp']);
            const usdRate = usdSetting ? parseFloat(usdSetting.setting_value) : 900; // Default USD rate
            return amount * usdRate;
        }
        return amount; // Fallback
    };

    // GET /api/support/companies
    getSupportCompanies = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { status, search, page = '1', limit = '50', month } = req.query;
            
            // Default to current month if not specified for billing calculations
            const selectedMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM format
            
            let query = `
                SELECT sc.*, 
                       COALESCE(t.total_tickets, 0) as total_tickets,
                       COALESCE(t.open_tickets, 0) as open_tickets,
                       COALESCE(h.current_month_consumed_hours, 0) as current_month_consumed_hours,
                       (sc.contracted_hours_monthly - COALESCE(h.current_month_consumed_hours, 0)) as current_month_remaining_hours
                FROM support_companies sc
                LEFT JOIN (
                    SELECT company_id, 
                           COUNT(*) as total_tickets,
                           SUM(CASE WHEN status IN ('open', 'in_progress', 'pending_client') THEN 1 ELSE 0 END) as open_tickets
                    FROM support_tickets 
                    GROUP BY company_id
                ) t ON sc.id = t.company_id
                LEFT JOIN (
                    SELECT st.company_id,
                           SUM(
                               CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                               THEN st.hours_spent
                               ELSE 0 END
                           ) as current_month_consumed_hours
                    FROM support_tickets st
                    GROUP BY st.company_id
                ) h ON sc.id = h.company_id
                WHERE 1=1
            `;

            const params: any[] = [selectedMonth, selectedMonth];

            if (status) {
                query += ' AND sc.status = ?';
                params.push(status);
            }

            if (search) {
                query += ' AND (sc.company_name LIKE ? OR sc.contact_person LIKE ? OR sc.email LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ' ORDER BY sc.company_name ASC';

            const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
            query += ` LIMIT ? OFFSET ?`;
            params.push(parseInt(limit as string), offset);

            const companies = await db.query(query, params);

            // Calculate monthly billing for each company
            for (const company of companies) {
                const consumedHours = company.current_month_consumed_hours || 0;
                const contractedHours = company.contracted_hours_monthly || 0;
                
                // Always bill contracted hours + any extra hours consumed
                const baseHours = contractedHours;
                const extraHours = Math.max(0, consumedHours - contractedHours);
                
                const baseValueInOriginalCurrency = baseHours * (company.hourly_rate || 0);
                const extraValueInOriginalCurrency = extraHours * (company.hourly_rate_extra || company.hourly_rate || 0);
                
                // Convert to CLP
                const baseValueInCLP = await this.convertToCLP(baseValueInOriginalCurrency, company.hourly_rate_currency);
                const extraValueInCLP = await this.convertToCLP(extraValueInOriginalCurrency, company.hourly_rate_currency);
                const totalToInvoiceInCLP = baseValueInCLP + extraValueInCLP;

                // Add billing info to company object
                company.monthly_billing = {
                    total_to_invoice_clp: Math.round(totalToInvoiceInCLP),
                    base_hours_value_clp: Math.round(baseValueInCLP),
                    extra_hours_value_clp: Math.round(extraValueInCLP),
                    consumed_hours: consumedHours,
                    base_hours: baseHours,
                    extra_hours: extraHours,
                    selected_month: selectedMonth
                };
            }

            // Get total count for pagination
            let countQuery = 'SELECT COUNT(*) as total FROM support_companies WHERE 1=1';
            const countParams: any[] = [];

            if (status) {
                countQuery += ' AND status = ?';
                countParams.push(status);
            }

            if (search) {
                countQuery += ' AND (company_name LIKE ? OR contact_person LIKE ? OR email LIKE ?)';
                countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            const { total } = await db.get(countQuery, countParams);

            res.json({
                data: companies,
                pagination: {
                    page: parseInt(page as string),
                    limit: parseInt(limit as string),
                    total,
                    pages: Math.ceil(total / parseInt(limit as string))
                }
            });
        } catch (error) {
            logger.error('Get support companies error:', error);
            res.status(500).json({ error: 'Failed to get support companies' });
        }
    };

    // GET /api/support/companies/:id
    getSupportCompany = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const [company] = await db.query(`
                SELECT sc.*, 
                       COALESCE(t.total_tickets, 0) as total_tickets,
                       COALESCE(t.open_tickets, 0) as open_tickets,
                       COALESCE(h.current_month_consumed_hours, 0) as current_month_consumed_hours,
                       (sc.contracted_hours_monthly - COALESCE(h.current_month_consumed_hours, 0)) as current_month_remaining_hours
                FROM support_companies sc
                LEFT JOIN (
                    SELECT company_id, 
                           COUNT(*) as total_tickets,
                           SUM(CASE WHEN status IN ('open', 'in_progress', 'pending_client') THEN 1 ELSE 0 END) as open_tickets
                    FROM support_tickets 
                    WHERE company_id = ?
                    GROUP BY company_id
                ) t ON sc.id = t.company_id
                LEFT JOIN (
                    SELECT st.company_id,
                           SUM(st.hours_spent) as current_month_consumed_hours
                    FROM support_tickets st
                    WHERE st.company_id = ?
                    GROUP BY st.company_id
                ) h ON sc.id = h.company_id
                WHERE sc.id = ?
            `, [id, id, id]);

            if (!company) {
                res.status(404).json({ error: 'Support company not found' });
                return;
            }

            res.json(company);
        } catch (error) {
            logger.error('Get support company error:', error);
            res.status(500).json({ error: 'Failed to get support company' });
        }
    };

    // POST /api/support/companies
    createSupportCompany = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const {
                company_name,
                contact_person,
                email,
                phone,
                contracted_hours_monthly,
                hourly_rate,
                hourly_rate_currency = 'CLP',
                hourly_rate_extra = 0,
                address,
                notes,
                contract_start_date,
                contract_end_date,
                status = 'active'
            } = req.body;

            // Validation
            if (!company_name || !contracted_hours_monthly || !hourly_rate) {
                res.status(400).json({ 
                    error: 'Missing required fields: company_name, contracted_hours_monthly, hourly_rate' 
                });
                return;
            }

            const result = await db.run(`
                INSERT INTO support_companies (
                    company_name, contact_person, email, phone, 
                    contracted_hours_monthly, hourly_rate, hourly_rate_currency, hourly_rate_extra,
                    address, notes, contract_start_date, contract_end_date, status,
                    created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [
                company_name, contact_person, email, phone,
                contracted_hours_monthly, hourly_rate, hourly_rate_currency, hourly_rate_extra,
                address, notes, contract_start_date, contract_end_date, status,
                req.user?.id
            ]);

            const newCompanyId = result.id!;
            
            // Get the created company
            const newCompany = await db.get(
                'SELECT * FROM support_companies WHERE id = ?', 
                [newCompanyId]
            );

            logger.info(`Support company created: ${company_name} (ID: ${newCompanyId})`);
            res.status(201).json(newCompany);
        } catch (error) {
            logger.error('Create support company error:', error);
            res.status(500).json({ error: 'Failed to create support company' });
        }
    };

    // PUT /api/support/companies/:id
    updateSupportCompany = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Check if company exists
            const existingCompany = await db.get(
                'SELECT * FROM support_companies WHERE id = ?', 
                [id]
            );

            if (!existingCompany) {
                res.status(404).json({ error: 'Support company not found' });
                return;
            }

            // Build update query dynamically
            const fields = [];
            const values = [];
            
            for (const [key, value] of Object.entries(updates)) {
                if (value !== undefined && key !== 'id') {
                    fields.push(`${key} = ?`);
                    values.push(value);
                }
            }

            if (fields.length === 0) {
                res.status(400).json({ error: 'No fields to update' });
                return;
            }

            fields.push('updated_at = datetime(\'now\')');
            values.push(id);

            await db.query(`
                UPDATE support_companies 
                SET ${fields.join(', ')} 
                WHERE id = ?
            `, values);

            // Get updated company
            const updatedCompany = await db.get(
                'SELECT * FROM support_companies WHERE id = ?', 
                [id]
            );

            logger.info(`Support company updated: ${updatedCompany.company_name} (ID: ${id})`);
            res.json(updatedCompany);
        } catch (error) {
            logger.error('Update support company error:', error);
            res.status(500).json({ error: 'Failed to update support company' });
        }
    };

    // DELETE /api/support/companies/:id
    deleteSupportCompany = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const userRole = req.user?.role;

            // Check if company exists
            const existingCompany = await db.get(
                'SELECT * FROM support_companies WHERE id = ?', 
                [id]
            );

            if (!existingCompany) {
                res.status(404).json({ error: 'Support company not found' });
                return;
            }

            // Check if company has tickets
            const ticketCount = await db.get(
                'SELECT COUNT(*) as count FROM support_tickets WHERE company_id = ?', 
                [id]
            );

            // If user is not admin and company has tickets, deny deletion
            if (ticketCount.count > 0 && userRole !== 'team_lead') {
                res.status(403).json({ 
                    error: 'Cannot delete company with existing tickets. Only administrators can perform cascade deletion.' 
                });
                return;
            }

            // Begin transaction for cascade deletion
            await db.beginTransaction();

            try {
                // If admin and has tickets, delete all tickets first (CASCADE)
                if (ticketCount.count > 0 && userRole === 'team_lead') {
                    // Delete ticket comments first (foreign key constraint)
                    await db.run(
                        'DELETE FROM support_ticket_comments WHERE ticket_id IN (SELECT id FROM support_tickets WHERE company_id = ?)', 
                        [id]
                    );

                    // Delete monthly summaries
                    await db.run('DELETE FROM support_monthly_summaries WHERE company_id = ?', [id]);

                    // Delete all tickets
                    await db.run('DELETE FROM support_tickets WHERE company_id = ?', [id]);
                    
                    logger.info(`Deleted ${ticketCount.count} tickets for company ${existingCompany.company_name}`);
                }

                // Delete the company
                await db.run('DELETE FROM support_companies WHERE id = ?', [id]);

                await db.commit();

                logger.info(`Support company deleted: ${existingCompany.company_name} (ID: ${id}) by ${userRole}`);
                res.json({ 
                    message: 'Support company deleted successfully',
                    deletedTickets: ticketCount.count
                });
            } catch (error) {
                await db.rollback();
                throw error;
            }
        } catch (error) {
            logger.error('Delete support company error:', error);
            res.status(500).json({ error: 'Failed to delete support company' });
        }
    };

    // GET /api/support/tickets
    getSupportTickets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { 
                company_id, status, priority, ticket_type, resolver_id, 
                search, date_from, date_to, page = '1', limit = '50' 
            } = req.query;
            
            let query = `
                SELECT st.*,
                       sc.company_name,
                       u.full_name as resolver_name,
                       st.hours_spent as hours_calculated
                FROM support_tickets st
                LEFT JOIN support_companies sc ON st.company_id = sc.id
                LEFT JOIN users u ON st.resolver_id = u.id
                WHERE 1=1
            `;

            const params: any[] = [];

            if (company_id) {
                query += ' AND st.company_id = ?';
                params.push(parseInt(company_id as string));
            }

            if (status) {
                query += ' AND st.status = ?';
                params.push(status);
            }

            if (priority) {
                query += ' AND st.priority = ?';
                params.push(priority);
            }

            if (ticket_type) {
                query += ' AND st.ticket_type = ?';
                params.push(ticket_type);
            }

            if (resolver_id) {
                query += ' AND st.resolver_id = ?';
                params.push(parseInt(resolver_id as string));
            }

            if (search) {
                query += ' AND (st.id_ticket LIKE ? OR st.client_name LIKE ? OR st.description LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (date_from) {
                query += ' AND DATE(st.created_at) >= DATE(?)';
                params.push(date_from);
            }

            if (date_to) {
                query += ' AND DATE(st.created_at) <= DATE(?)';
                params.push(date_to);
            }

            query += ' ORDER BY st.created_at DESC';

            const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
            query += ` LIMIT ? OFFSET ?`;
            params.push(parseInt(limit as string), offset);

            const tickets = await db.query(query, params);

            // Get total count for pagination
            let countQuery = 'SELECT COUNT(*) as total FROM support_tickets st WHERE 1=1';
            const countParams: any[] = [];

            if (company_id) {
                countQuery += ' AND st.company_id = ?';
                countParams.push(parseInt(company_id as string));
            }

            if (status) {
                countQuery += ' AND st.status = ?';
                countParams.push(status);
            }

            if (priority) {
                countQuery += ' AND st.priority = ?';
                countParams.push(priority);
            }

            if (ticket_type) {
                countQuery += ' AND st.ticket_type = ?';
                countParams.push(ticket_type);
            }

            if (resolver_id) {
                countQuery += ' AND st.resolver_id = ?';
                countParams.push(parseInt(resolver_id as string));
            }

            if (search) {
                countQuery += ' AND (st.id_ticket LIKE ? OR st.client_name LIKE ? OR st.description LIKE ?)';
                countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (date_from) {
                countQuery += ' AND DATE(st.created_at) >= DATE(?)';
                countParams.push(date_from);
            }

            if (date_to) {
                countQuery += ' AND DATE(st.created_at) <= DATE(?)';
                countParams.push(date_to);
            }

            const { total } = await db.get(countQuery, countParams);

            res.json({
                data: tickets,
                pagination: {
                    page: parseInt(page as string),
                    limit: parseInt(limit as string),
                    total,
                    pages: Math.ceil(total / parseInt(limit as string))
                }
            });
        } catch (error) {
            logger.error('Get support tickets error:', error);
            res.status(500).json({ error: 'Failed to get support tickets' });
        }
    };

    // POST /api/support/tickets
    createSupportTicket = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const {
                id_ticket,
                company_id,
                client_name,
                ticket_type,
                attention_method,
                rpa_process,
                description,
                solution,
                priority = 'medium',
                requester,
                work_date,
                completion_date,
                time_invested_minutes
            } = req.body;

            // Validation
            if (!company_id || !client_name || !ticket_type || !attention_method || !description) {
                res.status(400).json({ 
                    error: 'Missing required fields: company_id, client_name, ticket_type, attention_method, description' 
                });
                return;
            }

            // Check if company exists
            const company = await db.get(
                'SELECT * FROM support_companies WHERE id = ? AND status = "active"', 
                [company_id]
            );

            if (!company) {
                res.status(404).json({ error: 'Active support company not found' });
                return;
            }

            // Use user provided id_ticket or generate one
            const finalTicketId = id_ticket || `SUP-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`;

            // First get the next ID number  
            const nextIdResult = await db.get(`
                SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM support_tickets
            `);
            const nextId = nextIdResult.next_id;

            const hoursSpent = Math.round(((Number(time_invested_minutes) || 0) / 60.0) * 100) / 100;
            await db.run(`
                INSERT INTO support_tickets (
                    id, id_ticket, company_id, title, description, priority, status,
                    ticket_type, created_by, resolver_id, hours_spent,
                    created_at, resolved_at, updated_at,
                    attention_method, work_date, completion_date
                ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?, datetime('now'), NULL, datetime('now'), ?, ?, ?)
            `, [
                nextId, finalTicketId, company_id, client_name, description, priority,
                ticket_type, req.user?.id, hoursSpent,
                attention_method, work_date, completion_date
            ]);

            if (hoursSpent > 0 && hoursSpent <= 24 && req.user?.id) {
                const linkedProject = await db.get(
                    `SELECT p.id FROM projects p
                     LEFT JOIN clients c ON c.id = p.client_id
                     WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(?))
                        OR LOWER(TRIM(p.name)) LIKE LOWER(TRIM(?))
                     ORDER BY p.id DESC LIMIT 1`,
                    [company.company_name, `%${rpa_process || company.company_name}%`]
                );
                if (linkedProject?.id) {
                    const entryDate = work_date ? String(work_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
                    const lockedPeriod = await db.get(
                        `SELECT id FROM timesheet_periods WHERE user_id = ? AND period_start <= ? AND period_end >= ? AND status IN ('submitted', 'approved')`,
                        [req.user.id, entryDate, entryDate]
                    );
                    if (!lockedPeriod) {
                        const openPeriod = await db.get(
                            `SELECT id FROM timesheet_periods WHERE user_id = ? AND period_start <= ? AND period_end >= ? AND status = 'open'`,
                            [req.user.id, entryDate, entryDate]
                        );
                        await db.run(
                            `INSERT INTO time_entries (
                                user_id, project_id, description, hours, date, is_billable,
                                approval_status, timesheet_period_id, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, 1, 'draft', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                            [
                                req.user.id,
                                linkedProject.id,
                                `[Soporte ${finalTicketId} · ${company.company_name}] ${description}`,
                                hoursSpent,
                                entryDate,
                                openPeriod?.id ?? null
                            ]
                        );
                    }
                }
            }

            // Get the created ticket with company info
            const newTicket = await db.get(`
                SELECT st.*,
                       sc.company_name,
                       u.full_name as resolver_name,
                       st.hours_spent as hours_calculated
                FROM support_tickets st
                LEFT JOIN support_companies sc ON st.company_id = sc.id
                LEFT JOIN users u ON st.resolver_id = u.id
                WHERE st.id_ticket = ?
            `, [finalTicketId]);

            logger.info(`Support ticket created: ${id_ticket} for ${company.company_name}`);
            res.status(201).json(newTicket);
        } catch (error) {
            logger.error('Create support ticket error:', error);
            res.status(500).json({ error: 'Failed to create support ticket' });
        }
    };

    // PUT /api/support/tickets/:id
    updateSupportTicket = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            // Los nombres de columna salen siempre de la lista blanca, nunca de las claves que envía el cliente
            const selection = selectWritableColumns(req.body, SUPPORT_TICKET_UPDATABLE_COLUMNS, SUPPORT_TICKET_IGNORED_KEYS);
            if ('error' in selection) {
                res.status(400).json({ error: selection.error });
                return;
            }
            const { columns, values } = selection;

            // Check if ticket exists
            const existingTicket = await db.get(
                'SELECT * FROM support_tickets WHERE id_ticket = ?',
                [id]
            );

            if (!existingTicket) {
                res.status(404).json({ error: 'Support ticket not found' });
                return;
            }

            if (columns.length === 0) {
                res.status(400).json({ error: 'No hay campos para actualizar' });
                return;
            }

            const fields = columns.map(column => `${column} = ?`);

            // Auto-set resolved_at if status is resolved or closed
            const status = values[columns.indexOf('status')];
            if (status && ['resolved', 'closed'].includes(String(status))) {
                fields.push('resolved_at = datetime(\'now\')');
            }

            fields.push('updated_at = datetime(\'now\')');

            await db.run(`
                UPDATE support_tickets
                SET ${fields.join(', ')}
                WHERE id_ticket = ?
            `, [...values, id]);

            // Get updated ticket
            const updatedTicket = await db.get(`
                SELECT st.*,
                       sc.company_name,
                       u.full_name as resolver_name,
                       st.hours_spent as hours_calculated
                FROM support_tickets st
                LEFT JOIN support_companies sc ON st.company_id = sc.id
                LEFT JOIN users u ON st.resolver_id = u.id
                WHERE st.id_ticket = ?
            `, [id]);

            logger.info(`Support ticket updated: ${id}`);
            res.json(updatedTicket);
        } catch (error) {
            logger.error('Update support ticket error:', error);
            res.status(500).json({ error: 'Failed to update support ticket' });
        }
    };

    // GET /api/support/dashboard?company_id=X&month=YYYY-MM (opcional)
    getSupportDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { company_id, month } = req.query;
            
            // Default to current month if not specified
            const selectedMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM format

            // Summary statistics for selected month
            const summaryStats = await db.get(`
                SELECT
                    (SELECT COUNT(*) FROM support_companies) as totalCompanies,
                    (SELECT COUNT(*) FROM support_companies WHERE status = 'active') as activeCompanies,
                    (SELECT COUNT(*) FROM support_tickets WHERE strftime('%Y-%m', created_at) = ?) as thisMonthTickets,
                    (SELECT COUNT(*) FROM support_tickets WHERE status IN ('resolved', 'closed') AND strftime('%Y-%m', resolved_at) = ?) as thisMonthResolved
            `, [selectedMonth, selectedMonth]);

            // All companies by hour consumption for selected month
            const topCompanies = await db.query(`
                SELECT
                    sc.id,
                    sc.company_name,
                    sc.contracted_hours_monthly,
                    sc.hourly_rate,
                    sc.hourly_rate_extra,
                    sc.hourly_rate_currency,
                    sc.status,
                    COALESCE(SUM(
                        CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                        THEN st.hours_spent
                        ELSE 0 END
                    ), 0) as consumed_hours,
                    (sc.contracted_hours_monthly - COALESCE(SUM(
                        CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                        THEN st.hours_spent
                        ELSE 0 END
                    ), 0)) as remaining_hours,
                    CASE
                        WHEN COALESCE(SUM(
                            CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                            THEN st.hours_spent
                            ELSE 0 END
                        ), 0) > sc.contracted_hours_monthly THEN 'exceeded'
                        WHEN COALESCE(SUM(
                            CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                            THEN st.hours_spent
                            ELSE 0 END
                        ), 0) > (sc.contracted_hours_monthly * 0.8) THEN 'near_limit'
                        ELSE 'normal'
                    END as hour_status
                FROM support_companies sc
                LEFT JOIN support_tickets st ON sc.id = st.company_id
                GROUP BY sc.id, sc.company_name, sc.contracted_hours_monthly, sc.hourly_rate, sc.hourly_rate_extra, sc.hourly_rate_currency, sc.status
                ORDER BY consumed_hours DESC
            `, [selectedMonth, selectedMonth, selectedMonth, selectedMonth, selectedMonth, selectedMonth, selectedMonth, selectedMonth]);

            // Recent tickets from selected month
            const recentTickets = await db.query(`
                SELECT st.*,
                       sc.company_name,
                       u.full_name as resolver_name,
                       st.hours_spent as hours_calculated
                FROM support_tickets st
                LEFT JOIN support_companies sc ON st.company_id = sc.id
                LEFT JOIN users u ON st.resolver_id = u.id
                WHERE strftime('%Y-%m', st.created_at) = ?
                ORDER BY st.created_at DESC
                LIMIT 10
            `, [selectedMonth]);

            // Billing calculations - Global or specific company
            let billingQuery = '';
            let billingParams: any[] = [];

            if (company_id) {
                // Calculations for specific company
                billingQuery = `
                    SELECT
                        sc.company_name,
                        sc.contracted_hours_monthly,
                        sc.hourly_rate,
                        sc.hourly_rate_extra,
                        sc.hourly_rate_currency,
                        COALESCE(SUM(st.hours_spent), 0) as consumed_hours
                    FROM support_companies sc
                    LEFT JOIN support_tickets st ON sc.id = st.company_id
                    WHERE sc.id = ? AND sc.status = 'active'
                    GROUP BY sc.id
                `;
                billingParams = [company_id];
            } else {
                // Global calculations for all companies
                billingQuery = `
                    SELECT
                        SUM(sc.contracted_hours_monthly) as total_contracted_hours,
                        SUM(COALESCE(consumed.total_hours, 0)) as total_consumed_hours
                    FROM support_companies sc
                    LEFT JOIN (
                        SELECT
                            st.company_id,
                            SUM(st.hours_spent) as total_hours
                        FROM support_tickets st
                        GROUP BY st.company_id
                    ) consumed ON sc.id = consumed.company_id
                    WHERE sc.status = 'active'
                `;
            }

            const billingData = await db.get(billingQuery, billingParams);

            let billing = {};

            if (company_id) {
                // Company-specific calculations - FIXED MONTHLY CONTRACT
                // Always bill contracted hours + any extra hours consumed
                const contractedHours = billingData.contracted_hours_monthly;
                const extraHours = Math.max(0, billingData.consumed_hours - billingData.contracted_hours_monthly);
                
                const baseValueInOriginalCurrency = contractedHours * billingData.hourly_rate; // Always bill full contracted hours
                const extraValueInOriginalCurrency = extraHours * (billingData.hourly_rate_extra || billingData.hourly_rate);
                
                // Convert to CLP
                const baseValueInCLP = await this.convertToCLP(baseValueInOriginalCurrency, billingData.hourly_rate_currency);
                const extraValueInCLP = await this.convertToCLP(extraValueInOriginalCurrency, billingData.hourly_rate_currency);
                const totalToInvoiceInCLP = baseValueInCLP + extraValueInCLP;

                billing = {
                    company_name: billingData.company_name,
                    currency_original: billingData.hourly_rate_currency,
                    totalToInvoice: Math.round(totalToInvoiceInCLP),
                    baseHours: Math.round(baseValueInCLP),
                    extraHours: Math.round(extraValueInCLP),
                    consumed_hours: billingData.consumed_hours,
                    contracted_hours: billingData.contracted_hours_monthly
                };
            } else {
                // Global calculations - get all companies and sum their individual calculations for selected month
                // Only include companies that have tickets in the selected month OR are actively contracted for that month
                const allCompanies = await db.query(`
                    SELECT
                        sc.id,
                        sc.contracted_hours_monthly,
                        sc.hourly_rate,
                        sc.hourly_rate_extra,
                        sc.hourly_rate_currency,
                        COALESCE(SUM(
                            CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                            THEN st.hours_spent
                            ELSE 0 END
                        ), 0) as consumed_hours,
                        COUNT(
                            CASE WHEN strftime('%Y-%m', st.resolved_at) = ? OR strftime('%Y-%m', st.created_at) = ?
                            THEN st.id
                            END
                        ) as tickets_in_month
                    FROM support_companies sc
                    LEFT JOIN support_tickets st ON sc.id = st.company_id
                    WHERE sc.status = 'active'
                    GROUP BY sc.id
                    HAVING tickets_in_month > 0 OR sc.contracted_hours_monthly > 0
                `, [selectedMonth, selectedMonth, selectedMonth, selectedMonth]);

                let totalToInvoiceInCLP = 0;
                let totalBaseValueInCLP = 0;
                let totalExtraValueInCLP = 0;

                // Only calculate billing for companies that had activity in the selected month
                const companiesWithActivity = allCompanies.filter(company => company.tickets_in_month > 0);

                for (const company of companiesWithActivity) {
                    // FIXED MONTHLY CONTRACT: Always bill contracted hours + extra hours
                    const contractedHours = company.contracted_hours_monthly;
                    const extraHours = Math.max(0, company.consumed_hours - company.contracted_hours_monthly);

                    const baseValueInOriginalCurrency = contractedHours * company.hourly_rate; // Always bill full contracted hours
                    const extraValueInOriginalCurrency = extraHours * (company.hourly_rate_extra || company.hourly_rate);

                    const baseValueInCLP = await this.convertToCLP(baseValueInOriginalCurrency, company.hourly_rate_currency);
                    const extraValueInCLP = await this.convertToCLP(extraValueInOriginalCurrency, company.hourly_rate_currency);

                    totalBaseValueInCLP += baseValueInCLP;
                    totalExtraValueInCLP += extraValueInCLP;
                    totalToInvoiceInCLP += baseValueInCLP + extraValueInCLP;
                }

                billing = {
                    totalToInvoice: Math.round(totalToInvoiceInCLP),
                    baseHours: Math.round(totalBaseValueInCLP),
                    extraHours: Math.round(totalExtraValueInCLP),
                    total_companies: companiesWithActivity.length
                };
            }

            res.json({
                summary: summaryStats,
                topCompanies,
                recentTickets,
                billing,
                selected_company_id: company_id || null
            });
        } catch (error) {
            logger.error('Get support dashboard error:', error);
            res.status(500).json({ error: 'Failed to get support dashboard' });
        }
    };

    // GET /api/support/companies/:id/billing
    getCompanyBilling = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const billingData = await db.get(`
                SELECT
                    sc.company_name,
                    sc.contracted_hours_monthly,
                    sc.hourly_rate,
                    sc.hourly_rate_extra,
                    sc.hourly_rate_currency,
                    COALESCE(SUM(st.hours_spent), 0) as consumed_hours
                FROM support_companies sc
                LEFT JOIN support_tickets st ON sc.id = st.company_id
                WHERE sc.id = ? AND sc.status = 'active'
                GROUP BY sc.id, sc.company_name, sc.contracted_hours_monthly, sc.hourly_rate, sc.hourly_rate_extra, sc.hourly_rate_currency
            `, [id]);

            if (!billingData) {
                res.status(404).json({ error: 'Company not found' });
                return;
            }

            // Correct billing logic with hourly_rate_extra
            const baseHours = Math.min(billingData.consumed_hours, billingData.contracted_hours_monthly);
            const extraHours = Math.max(0, billingData.consumed_hours - billingData.contracted_hours_monthly);
            
            const baseValueInOriginalCurrency = baseHours * billingData.hourly_rate;
            const extraValueInOriginalCurrency = extraHours * (billingData.hourly_rate_extra || billingData.hourly_rate);
            
            // Convert to CLP
            const baseValueInCLP = await this.convertToCLP(baseValueInOriginalCurrency, billingData.hourly_rate_currency);
            const extraValueInCLP = await this.convertToCLP(extraValueInOriginalCurrency, billingData.hourly_rate_currency);
            const totalToInvoiceInCLP = baseValueInCLP + extraValueInCLP;

            res.json({
                company_name: billingData.company_name,
                contracted_hours_monthly: billingData.contracted_hours_monthly,
                consumed_hours: billingData.consumed_hours,
                remaining_hours: Math.max(0, billingData.contracted_hours_monthly - billingData.consumed_hours),
                base_hours: baseHours,
                extra_hours: extraHours,
                hourly_rate: billingData.hourly_rate,
                hourly_rate_extra: billingData.hourly_rate_extra,
                currency: billingData.hourly_rate_currency,
                base_charges: Math.round(baseValueInCLP),
                extra_charges: Math.round(extraValueInCLP),
                total_to_invoice: Math.round(totalToInvoiceInCLP)
            });
        } catch (error) {
            logger.error('Get company billing error:', error);
            res.status(500).json({ error: 'Failed to get company billing' });
        }
    };

    // GET /api/support/rpa-processes?company_id=X
    getRPAProcesses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { company_id } = req.query;
            
            if (!company_id) {
                res.json({ data: [] });
                return;
            }

            const processes = await db.query(`
                SELECT * FROM support_rpa_processes 
                WHERE company_id = ? AND is_active = 1 
                ORDER BY process_name ASC
            `, [company_id]);

            res.json({ data: processes });
        } catch (error) {
            logger.error('Get RPA processes error:', error);
            res.status(500).json({ error: 'Failed to get RPA processes' });
        }
    };

    // POST /api/support/rpa-processes
    createRPAProcess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { company_id, process_name, process_description } = req.body;
            
            if (!company_id || !process_name) {
                res.status(400).json({ error: 'Company ID and process name are required' });
                return;
            }

            const result = await db.run(
                'INSERT INTO support_rpa_processes (company_id, process_name, process_description) VALUES (?, ?, ?)',
                [company_id, process_name, process_description || null]
            );

            const newProcess = await db.get(
                'SELECT * FROM support_rpa_processes WHERE id = ?',
                [result.id]
            );

            res.status(201).json(newProcess);
        } catch (error: any) {
            logger.error('Create RPA process error:', error);
            if (error.message?.includes('UNIQUE constraint failed')) {
                res.status(409).json({ error: 'Process name already exists for this company' });
            } else {
                res.status(500).json({ error: 'Failed to create RPA process' });
            }
        }
    };

    // GET /api/support/companies/:id/contacts
    getCompanyContacts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            
            const contacts = await db.query(`
                SELECT * FROM support_company_contacts 
                WHERE company_id = ? AND is_active = 1 
                ORDER BY is_primary DESC, contact_name ASC
            `, [id]);

            res.json({ data: contacts });
        } catch (error) {
            logger.error('Get company contacts error:', error);
            res.status(500).json({ error: 'Failed to get company contacts' });
        }
    };

    // POST /api/support/companies/:id/contacts
    createCompanyContact = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { contact_name, contact_email, contact_phone, position, is_primary } = req.body;
            
            if (!contact_name) {
                res.status(400).json({ error: 'Contact name is required' });
                return;
            }

            // If setting as primary, unset other primary contacts first
            if (is_primary) {
                await db.run(
                    'UPDATE support_company_contacts SET is_primary = 0 WHERE company_id = ?',
                    [id]
                );
            }

            const result = await db.run(`
                INSERT INTO support_company_contacts 
                (company_id, contact_name, contact_email, contact_phone, position, is_primary) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [id, contact_name, contact_email || null, contact_phone || null, position || null, is_primary ? 1 : 0]);

            const newContact = await db.get(
                'SELECT * FROM support_company_contacts WHERE id = ?',
                [result.id]
            );

            res.status(201).json(newContact);
        } catch (error: any) {
            logger.error('Create company contact error:', error);
            if (error.message?.includes('UNIQUE constraint failed')) {
                res.status(409).json({ error: 'Contact name already exists for this company' });
            } else {
                res.status(500).json({ error: 'Failed to create contact' });
            }
        }
    };

    // GET /api/support/contacts - Get all contacts for dropdown
    getAllContacts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const contacts = await db.query(`
                SELECT scc.*, sc.company_name 
                FROM support_company_contacts scc
                INNER JOIN support_companies sc ON scc.company_id = sc.id
                WHERE scc.is_active = 1 AND sc.status = 'active'
                ORDER BY sc.company_name, scc.contact_name ASC
            `);

            res.json({ data: contacts });
        } catch (error) {
            logger.error('Get all contacts error:', error);
            res.status(500).json({ error: 'Failed to get contacts' });
        }
    };

    // Configure multer for file uploads
    private upload = multer({
        dest: 'uploads/',
        fileFilter: (req, file, cb) => {
            const allowedMimes = [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/csv'
            ];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Only Excel and CSV files are allowed'));
            }
        },
        limits: {
            fileSize: 10 * 1024 * 1024 // 10MB limit
        }
    });

    // POST /api/support/import/preview - Preview Excel file structure
    previewExcelImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'No file uploaded' });
                return;
            }

            const { headers, rows } = await this.readSpreadsheet(req.file.path, req.file.mimetype);

            if (headers.length === 0) {
                res.status(400).json({ error: 'Excel file is empty' });
                return;
            }

            const sampleData = rows.slice(0, 5);

            // Define available field mappings
            const availableFields = [
                { key: 'id_ticket', label: 'ID Ticket', required: false },
                { key: 'company_name', label: 'Cliente', required: true },
                { key: 'ticket_type', label: 'Tipo', required: true },
                { key: 'attention_method', label: 'Método Atención', required: false },
                { key: 'rpa_process_name', label: 'Proceso RPA', required: false },
                { key: 'requester_name', label: 'Solicitante', required: false },
                { key: 'resolver_name', label: 'Resolutor', required: false },
                { key: 'description', label: 'Descripción', required: true },
                { key: 'status', label: 'Estado', required: false },
                { key: 'solution', label: 'Solución', required: false },
                { key: 'opened_date', label: 'Fecha Apertura', required: false },
                { key: 'closed_date', label: 'Fecha Cierre', required: false },
                { key: 'time_invested_minutes', label: 'Tiempo Invertido (min)', required: false },
                { key: 'hours', label: 'Horas', required: false }
            ];

            // Auto-suggest field mappings based on header names
            const suggestedMappings: { [key: string]: string } = {};
            headers.forEach(header => {
                const normalizedHeader = header.toLowerCase().trim();
                
                // Try to match with available fields
                availableFields.forEach(field => {
                    const normalizedFieldLabel = field.label.toLowerCase();
                    if (normalizedHeader.includes(normalizedFieldLabel) || 
                        normalizedFieldLabel.includes(normalizedHeader)) {
                        suggestedMappings[header] = field.key;
                    }
                });

                // Additional specific mappings
                if (normalizedHeader.includes('id') && normalizedHeader.includes('ticket')) {
                    suggestedMappings[header] = 'id_ticket';
                } else if (normalizedHeader.includes('cliente') || normalizedHeader.includes('company')) {
                    suggestedMappings[header] = 'company_name';
                } else if (normalizedHeader.includes('tipo') || normalizedHeader.includes('type')) {
                    suggestedMappings[header] = 'ticket_type';
                } else if (normalizedHeader.includes('metodo') || normalizedHeader.includes('method')) {
                    suggestedMappings[header] = 'attention_method';
                } else if (normalizedHeader.includes('proceso') || normalizedHeader.includes('rpa')) {
                    suggestedMappings[header] = 'rpa_process_name';
                } else if (normalizedHeader.includes('solicitante') || normalizedHeader.includes('requester')) {
                    suggestedMappings[header] = 'requester_name';
                } else if (normalizedHeader.includes('resolutor') || normalizedHeader.includes('resolver')) {
                    suggestedMappings[header] = 'resolver_name';
                } else if (normalizedHeader.includes('descripcion') || normalizedHeader.includes('description')) {
                    suggestedMappings[header] = 'description';
                } else if (normalizedHeader.includes('estado') || normalizedHeader.includes('status')) {
                    suggestedMappings[header] = 'status';
                } else if (normalizedHeader.includes('solucion') || normalizedHeader.includes('solution')) {
                    suggestedMappings[header] = 'solution';
                } else if (normalizedHeader.includes('apertura') || normalizedHeader.includes('opened')) {
                    suggestedMappings[header] = 'opened_date';
                } else if (normalizedHeader.includes('cierre') || normalizedHeader.includes('closed')) {
                    suggestedMappings[header] = 'closed_date';
                } else if (normalizedHeader.includes('tiempo') || normalizedHeader.includes('minuto')) {
                    suggestedMappings[header] = 'time_invested_minutes';
                } else if (normalizedHeader.includes('hora') && !normalizedHeader.includes('apertura')) {
                    suggestedMappings[header] = 'hours';
                }
            });

            // Clean up the uploaded file
            fs.unlink(req.file.path, (err) => {
                if (err) logger.warn('Failed to delete temp file:', err);
            });

            res.json({
                headers,
                sampleData,
                availableFields,
                suggestedMappings,
                totalRows: rows.length
            });
        } catch (error) {
            logger.error('Preview Excel import error:', error);
            res.status(500).json({ error: 'Failed to preview Excel file' });
        }
    };

    // POST /api/support/import/execute - Execute Excel import with field mappings
    executeExcelImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'No file uploaded' });
                return;
            }

            const { mappings, options = {} } = req.body;
            
            if (!mappings) {
                res.status(400).json({ error: 'Field mappings are required' });
                return;
            }

            const parsedMappings = typeof mappings === 'string' ? JSON.parse(mappings) : mappings;
            const parsedOptions = typeof options === 'string' ? JSON.parse(options) : options;

            const { records: jsonData } = await this.readSpreadsheet(req.file.path, req.file.mimetype);

            const results = {
                totalRows: jsonData.length,
                successCount: 0,
                errorCount: 0,
                errors: [] as any[],
                warnings: [] as any[]
            };

            for (let i = 0; i < jsonData.length; i++) {
                try {
                    const row = jsonData[i] as any;
                    const ticketData: any = {};

                    // Map fields based on user mappings
                    Object.entries(parsedMappings).forEach(([excelHeader, fieldKey]) => {
                        if (fieldKey && row[excelHeader] !== undefined && row[excelHeader] !== null && row[excelHeader] !== '') {
                            ticketData[fieldKey as string] = row[excelHeader];
                        }
                    });

                    // Skip empty rows
                    if (Object.keys(ticketData).length === 0) {
                        continue;
                    }

                    // Validate required fields
                    if (!ticketData.company_name) {
                        results.errors.push({ row: i + 2, error: 'Cliente es requerido' });
                        results.errorCount++;
                        continue;
                    }

                    if (!ticketData.description) {
                        results.errors.push({ row: i + 2, error: 'Descripción es requerida' });
                        results.errorCount++;
                        continue;
                    }

                    // Find or create company
                    let company = await db.get(
                        'SELECT id FROM support_companies WHERE LOWER(company_name) = LOWER(?)',
                        [ticketData.company_name]
                    );

                    if (!company && parsedOptions.createMissingCompanies !== false) {
                        const companyResult = await db.run(
                            'INSERT INTO support_companies (company_name, contracted_hours_monthly, hourly_rate, hourly_rate_currency, hourly_rate_extra, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [ticketData.company_name, 0, 0, 'CLP', 0, 'active', req.user?.id]
                        );
                        company = { id: companyResult.id };
                        results.warnings.push({ 
                            row: i + 2, 
                            warning: `Empresa creada automáticamente: ${ticketData.company_name}` 
                        });
                    }

                    if (!company) {
                        results.errors.push({ 
                            row: i + 2, 
                            error: `Empresa no encontrada: ${ticketData.company_name}` 
                        });
                        results.errorCount++;
                        continue;
                    }

                    // Find or create RPA process if specified
                    let rpaProcessId = null;
                    if (ticketData.rpa_process_name) {
                        let rpaProcess = await db.get(
                            'SELECT id FROM support_rpa_processes WHERE LOWER(process_name) = LOWER(?) AND company_id = ?',
                            [ticketData.rpa_process_name, company.id]
                        );

                        if (!rpaProcess && parsedOptions.createMissingProcesses !== false) {
                            const processResult = await db.run(
                                'INSERT INTO support_rpa_processes (company_id, process_name) VALUES (?, ?)',
                                [company.id, ticketData.rpa_process_name]
                            );
                            rpaProcess = { id: processResult.id };
                            results.warnings.push({ 
                                row: i + 2, 
                                warning: `Proceso RPA creado automáticamente: ${ticketData.rpa_process_name}` 
                            });
                        }

                        if (rpaProcess) {
                            rpaProcessId = rpaProcess.id;
                        }
                    }

                    // Find resolver user if specified
                    let resolverId = null;
                    if (ticketData.resolver_name) {
                        const resolver = await db.get(
                            'SELECT id FROM users WHERE LOWER(full_name) = LOWER(?) OR LOWER(email) = LOWER(?)',
                            [ticketData.resolver_name, ticketData.resolver_name]
                        );
                        if (resolver) {
                            resolverId = resolver.id;
                        }
                    }

                    // Parse dates
                    const parseDate = (dateValue: any) => {
                        if (!dateValue) return null;
                        
                        // Handle Excel date serial numbers
                        if (typeof dateValue === 'number') {
                            const excelEpoch = new Date(1900, 0, 1);
                            const date = new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
                            return date.toISOString().split('T')[0];
                        }
                        
                        // Handle date strings
                        if (typeof dateValue === 'string') {
                            const date = new Date(dateValue);
                            if (!isNaN(date.getTime())) {
                                return date.toISOString().split('T')[0];
                            }
                        }
                        
                        return null;
                    };

                    // Convert time invested to minutes if it's in hours
                    let timeInMinutes = null;
                    if (ticketData.time_invested_minutes) {
                        timeInMinutes = parseInt(ticketData.time_invested_minutes);
                    } else if (ticketData.hours) {
                        timeInMinutes = parseFloat(ticketData.hours) * 60;
                    }

                    // Validate and map status values
                    const validStatuses = ['open', 'in_progress', 'pending_client', 'resolved', 'closed', 'cancelled'];
                    let mappedStatus = 'open'; // default
                    
                    if (ticketData.status) {
                        const normalizedStatus = ticketData.status.toLowerCase().trim();
                        
                        // Map common status variations to valid values
                        const statusMapping: { [key: string]: string } = {
                            'abierto': 'open',
                            'open': 'open',
                            'nuevo': 'open',
                            'pendiente': 'open',
                            'en_progreso': 'in_progress',
                            'en progreso': 'in_progress',
                            'in_progress': 'in_progress',
                            'working': 'in_progress',
                            'trabajando': 'in_progress',
                            'esperando_cliente': 'pending_client',
                            'esperando cliente': 'pending_client',
                            'pending_client': 'pending_client',
                            'waiting': 'pending_client',
                            'resuelto': 'resolved',
                            'resolved': 'resolved',
                            'solucionado': 'resolved',
                            'cerrado': 'closed',
                            'closed': 'closed',
                            'finalizado': 'closed',
                            'cancelado': 'cancelled',
                            'cancelled': 'cancelled',
                            'canceled': 'cancelled'
                        };
                        
                        mappedStatus = statusMapping[normalizedStatus] || 'open';
                    }

                    // Validate and map priority values
                    const validPriorities = ['critical', 'high', 'medium', 'low'];
                    let mappedPriority = 'medium'; // default
                    
                    if (ticketData.priority) {
                        const normalizedPriority = ticketData.priority.toLowerCase().trim();
                        
                        const priorityMapping: { [key: string]: string } = {
                            'critico': 'critical',
                            'crítico': 'critical',
                            'critical': 'critical',
                            'urgente': 'critical',
                            'alto': 'high',
                            'alta': 'high',
                            'high': 'high',
                            'medio': 'medium',
                            'media': 'medium',
                            'medium': 'medium',
                            'normal': 'medium',
                            'bajo': 'low',
                            'baja': 'low',
                            'low': 'low'
                        };
                        
                        mappedPriority = priorityMapping[normalizedPriority] || 'medium';
                    }

                    // Create support ticket
                    // First get next ID number
                    const nextIdResult = await db.get('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM support_tickets');
                    const nextId = nextIdResult.next_id;

                    // Debug logging
                    console.log(`Row ${i + 2}: Original status = '${ticketData.status}', Mapped status = '${mappedStatus}'`);

                    const insertResult = await db.run(`
                        INSERT INTO support_tickets (
                            id, id_ticket, company_id, title, description, priority, status,
                            ticket_type, created_by, resolver_id, hours_spent,
                            created_at, resolved_at, updated_at,
                            attention_method, work_date, completion_date
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
                    `, [
                        nextId,
                        ticketData.id_ticket || `SUP-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`,
                        company.id,
                        ticketData.requester_name || 'Imported Client', // title
                        ticketData.description,
                        mappedPriority,
                        mappedStatus,
                        ticketData.ticket_type || 'support',
                        req.user?.id,
                        resolverId,
                        timeInMinutes ? timeInMinutes / 60.0 : 0, // Convert minutes to hours
                        parseDate(ticketData.opened_date) || new Date().toISOString(), // created_at
                        parseDate(ticketData.closed_date), // resolved_at
                        ticketData.attention_method || 'email',
                        parseDate(ticketData.work_date),
                        parseDate(ticketData.closed_date) // completion_date
                    ]);

                    results.successCount++;
                } catch (rowError) {
                    logger.error(`Error processing row ${i + 2}:`, rowError);
                    results.errors.push({ 
                        row: i + 2, 
                        error: `Error al procesar fila: ${(rowError as Error).message}` 
                    });
                    results.errorCount++;
                }
            }

            // Clean up the uploaded file
            fs.unlink(req.file.path, (err) => {
                if (err) logger.warn('Failed to delete temp file:', err);
            });

            logger.info(`Excel import completed: ${results.successCount} success, ${results.errorCount} errors`);
            res.json(results);
        } catch (error) {
            logger.error('Execute Excel import error:', error);
            res.status(500).json({ error: 'Failed to import Excel file' });
        }
    };

    // Multer middleware getter
    getUploadMiddleware() {
        return this.upload.single('file');
    }
}
