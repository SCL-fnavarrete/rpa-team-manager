import { z } from 'zod';
import { SCOPING_OPTIONS } from '../services/scopingCalculationEngine';

// User validation schemas
// Note: password length/complexity is enforced at creation/change time (createUserSchema),
// not at login - existing accounts must not be locked out by a stricter login policy.
export const loginSchema = z.object({
    email: z.string().email('Invalid email format').max(100),
    password: z.string().min(1, 'Password is required').max(128)
});

export const createUserSchema = z.object({
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    email: z.string().email('Invalid email format').max(100),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    full_name: z.string().min(2).max(100),
    role: z.enum(['team_lead', 'rpa_developer', 'rpa_operations', 'it_support'])
});

// Project validation schemas
// projects.status solo acepta estos 4 valores (CHECK de la migración 1); 'planning' nunca existió en la BD.
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
const CURRENCIES = ['CLP', 'USD', 'UF'] as const;

export const createProjectSchema = z.object({
    name: z.string().min(1, 'Project name is required').max(200),
    description: z.string().max(1000).optional().nullable(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    budget: z.number().min(0, 'Budget must be positive').max(999999999.99).optional().nullable(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
    assigned_to: z.number().int().positive().optional().nullable(),
    client_id: z.number().int().positive().optional().nullable(),
    client_contact_id: z.number().int().positive().optional().nullable(),
    sales_rep_id: z.number().int().positive().optional().nullable(),
    opportunity_source: z.enum(['direct', 'sales']).optional(),
    area_id: z.number().int().positive().optional().nullable(),
    pm_user_id: z.number().int().positive().optional().nullable(),
    project_type: z.enum(['internal', 'commercial']).optional(),
    currency: z.enum(CURRENCIES).optional(),
    sale_price: z.number().min(0).max(999999999999.99).optional().nullable(),
    sale_price_currency: z.enum(CURRENCIES).optional(),
    hours_budgeted: z.number().min(0).max(99999).optional().nullable()
});

export const updateProjectSchema = createProjectSchema.extend({
    actual_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    actual_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    progress_percentage: z.number().int().min(0).max(100).optional()
}).partial();

// Support validation schemas
export const createSupportCompanySchema = z.object({
    company_name: z.string().min(1, 'Company name is required').max(200),
    contact_person: z.string().max(100).optional(),
    email: z.string().email('Invalid email format').max(100).optional(),
    phone: z.string().max(20).regex(/^[\+]?[0-9\-\s\(\)]+$/, 'Invalid phone format').optional(),
    contracted_hours_monthly: z.number().int().min(0).max(999),
    hourly_rate: z.number().positive('Hourly rate must be positive').max(9999.99),
    hourly_rate_extra: z.number().min(0).max(9999.99).optional(),
    hourly_rate_currency: z.enum(['USD', 'UF', 'CLP']),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    contract_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    contract_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional()
});

export const updateSupportCompanySchema = createSupportCompanySchema.partial();

// PMO validation schemas
export const createMilestoneSchema = z.object({
    project_id: z.number().int().positive('Valid project ID required'),
    name: z.string().min(1, 'Milestone name is required').max(200),
    description: z.string().max(500).optional(),
    milestone_type: z.enum(['delivery', 'review', 'approval', 'testing', 'deployment']).optional(),
    planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    actual_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    responsible_user_id: z.number().int().positive().optional(),
    impact_on_timeline: z.number().int().min(-365).max(365).optional(),
    responsibility: z.string().max(50).optional(),
    blocking_reason: z.string().max(1000).optional(),
    delay_justification: z.string().max(1000).optional(),
    external_contact: z.string().max(200).optional(),
    estimated_delay_days: z.number().int().optional(),
    financial_impact: z.number().optional(),
    status: z.string().max(50).optional()
});

// Task validation schemas
export const createTaskSchema = z.object({
    board_id: z.number().int().positive('Valid board ID required'),
    column_id: z.number().int().positive('Valid column ID required'),
    title: z.string().min(1, 'Task title is required').max(255),
    description: z.string().max(2000).optional(),
    task_type: z.enum(['task', 'bug', 'feature', 'research', 'documentation']).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    assignee_id: z.number().int().positive().optional(),
    assignee_ids: z.array(z.number().int().positive()).optional(),
    story_points: z.number().int().min(0).max(100).optional(),
    estimated_hours: z.number().positive().max(9999.99).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be in YYYY-MM-DD format').optional().nullable()
});

// ID parameter validation
export const idParamSchema = z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a positive integer').transform(Number)
});

// Query parameter validation
export const paginationSchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).refine(val => !val || val <= 100, 'Limit cannot exceed 100').optional()
});

export const dateRangeSchema = z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format').optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format').optional()
});

// File upload validation
export const fileUploadSchema = z.object({
    filename: z.string().min(1).max(255).refine(
        (name) => /^[a-zA-Z0-9._-]+$/.test(name),
        'Filename contains invalid characters'
    ),
    mimetype: z.string().refine(
        (type) => ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(type),
        'File type not allowed'
    ),
    size: z.number().max(10 * 1024 * 1024, 'File size cannot exceed 10MB')
});

// Time entry validation
// Note: user_id is derived server-side from the authenticated session, never from the client body.
export const createTimeEntrySchema = z.object({
    project_id: z.number().int().positive('Valid project ID required'),
    task_id: z.number().int().positive('Valid task ID required').optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    hours: z.number().positive('Hours must be positive').max(24, 'Hours cannot exceed 24 per day'),
    description: z.string().max(500).optional(),
    start_time: z.string().max(20).optional(),
    end_time: z.string().max(20).optional(),
    is_billable: z.boolean().optional()
});

// Billing / Payment Milestones validation schemas (Fase 2)
export const createPaymentMilestoneSchema = z.object({
    project_id: z.number().int().positive('Valid project ID required'),
    project_milestone_id: z.number().int().positive().optional().nullable(),
    name: z.string().min(1, 'Milestone name is required').max(200),
    description: z.string().max(1000).optional(),
    amount: z.number().positive('Amount must be positive'),
    currency: z.enum(['CLP', 'USD', 'UF']),
    trigger_type: z.enum(['date', 'progress_pct', 'deliverable_approved']),
    trigger_value: z.number().min(0).max(100).optional().nullable(),
    planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
    sort_order: z.number().int().optional(),
    cost_center_id: z.number().int().positive().optional().nullable()
}).refine(
    (data) => data.trigger_type !== 'progress_pct' || (data.trigger_value !== null && data.trigger_value !== undefined),
    { message: 'trigger_value is required when trigger_type is progress_pct', path: ['trigger_value'] }
).refine(
    (data) => (data.trigger_type !== 'progress_pct' && data.trigger_type !== 'deliverable_approved') || !!data.project_milestone_id,
    { message: 'project_milestone_id is required for progress_pct and deliverable_approved triggers', path: ['project_milestone_id'] }
).refine(
    (data) => data.trigger_type !== 'date' || !!data.planned_date,
    { message: 'planned_date is required when trigger_type is date', path: ['planned_date'] }
);

export const updatePaymentMilestoneSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    amount: z.number().positive().optional(),
    currency: z.enum(['CLP', 'USD', 'UF']).optional(),
    planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
    trigger_value: z.number().min(0).max(100).optional().nullable(),
    sort_order: z.number().int().optional(),
    cost_center_id: z.number().int().positive().optional().nullable()
});

export const createInvoiceSchema = z.object({
    project_id: z.number().int().positive('Valid project ID required'),
    invoice_number: z.string().min(1, 'Invoice number is required').max(50),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    payment_milestone_ids: z.array(z.number().int().positive()).min(1, 'At least one payment milestone is required'),
    notes: z.string().max(2000).optional()
});

export const createPaymentSchema = z.object({
    amount: z.number().positive('Amount must be positive'),
    currency: z.enum(['CLP', 'USD', 'UF']),
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    method: z.string().max(50).optional(),
    reference: z.string().max(100).optional(),
    notes: z.string().max(1000).optional()
});

// Timesheet validation schemas (Fase 3)
export const saveWeekEntrySchema = z.object({
    id: z.number().int().positive().optional(),
    project_id: z.number().int().positive('Valid project ID required'),
    task_id: z.number().int().positive().optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    hours: z.number().min(0.01, 'Hours must be greater than 0').max(24, 'Hours must be 24 or less'),
    is_billable: z.boolean().optional()
});

export const saveWeekSchema = z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    entries: z.array(saveWeekEntrySchema)
});

export const submitWeekSchema = z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
});

export const rejectWeekSchema = z.object({
    reason: z.string().min(1, 'A rejection reason is required').max(500)
});

// Cotizador RPA (scoping). El motor exige entradas completas y numéricas; aquí se rechaza todo lo demás.
// Estos mensajes le llegan tal cual al usuario (validate(..., { inlineErrors: true })), por eso van en español.
const SCOPING_MAX_NUMBER = 1_000_000_000;
const SCOPING_WEEKS_MESSAGE = 'Las semanas estimadas deben ser un número entero entre 1 y 520';
const SCOPING_STATUSES = ['draft', 'sent_to_client', 'approved', 'rejected', 'converted_to_project'] as const;

const scopingOption = (values: readonly [string, ...string[]], message: string) => z.enum(values, { error: message });
const scopingNonNegative = (message: string) => z.number({ error: message }).min(0, message).max(SCOPING_MAX_NUMBER, message);
const scopingPercent = (message: string) => z.number({ error: message }).min(0, message).max(100, message);
const scopingText = (field: string, max: number) =>
    z.string({ error: `El campo ${field} debe ser texto` }).max(max, `El campo ${field} no puede superar ${max} caracteres`);
const scopingRequiredText = (label: string, max: number) =>
    z.string({ error: `${label} es obligatorio` }).trim().min(1, `${label} es obligatorio`).max(max, `${label} no puede superar ${max} caracteres`);

const scopingCustomHours = z.object({
    lp: scopingNonNegative('Las horas del Líder de Proyecto (LP) deben ser un número mayor o igual a cero'),
    crpa: scopingNonNegative('Las horas del Consultor RPA (CRPA) deben ser un número mayor o igual a cero'),
    ar: scopingNonNegative('Las horas del Automatizador (AR) deben ser un número mayor o igual a cero'),
    adv: scopingNonNegative('Las horas de los Advisors (ADV) deben ser un número mayor o igual a cero'),
    weeks: z.number({ error: SCOPING_WEEKS_MESSAGE }).int(SCOPING_WEEKS_MESSAGE).min(1, SCOPING_WEEKS_MESSAGE).max(520, SCOPING_WEEKS_MESSAGE)
}, { error: 'Las horas calibradas deben enviarse como un objeto' }).partial();

const scopingBodyError = (issue: { input?: unknown }) =>
    issue.input === undefined ? 'El cuerpo de la solicitud está vacío' : 'El cuerpo de la solicitud no es válido';

// Un cuerpo {} se informa como "vacío" en vez de listar el primer campo faltante.
const scopingBody = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0 ? undefined : value), schema);

// Entradas del cálculo. custom_hours: null o ausente = sin calibración manual.
const scopingInputsShape = {
    data_input_type: scopingOption(SCOPING_OPTIONS.data_input_type, 'El tipo de entrada de datos no es válido'),
    rule_based_level: scopingOption(SCOPING_OPTIONS.rule_based_level, 'El nivel de reglas del proceso no es válido'),
    process_stability: scopingOption(SCOPING_OPTIONS.stability, 'La estabilidad del proceso no es válida'),
    application_stability: scopingOption(SCOPING_OPTIONS.stability, 'La estabilidad de las aplicaciones no es válida'),
    frequency: scopingOption(SCOPING_OPTIONS.frequency, 'La frecuencia del proceso no es válida'),
    volume_per_frequency: z.number({ error: 'El volumen por frecuencia debe ser un número' })
        .min(1, 'El volumen por frecuencia debe ser al menos 1').max(SCOPING_MAX_NUMBER, 'El volumen por frecuencia es demasiado grande'),
    aht_minutes: z.number({ error: 'El tiempo promedio por ejecución (AHT) debe ser un número' })
        .gt(0, 'El tiempo promedio por ejecución (AHT) debe ser mayor que cero').max(SCOPING_MAX_NUMBER, 'El tiempo promedio por ejecución (AHT) es demasiado grande'),
    current_ftes: scopingNonNegative('Los colaboradores actuales (FTEs) deben ser un número mayor o igual a cero').optional(),
    error_rate_pct: scopingPercent('La tasa de error debe ser un número entre 0 y 100').optional(),
    peak_period: scopingOption(SCOPING_OPTIONS.peak_period, 'El periodo punta no es válido').optional(),
    process_steps_count: scopingOption(SCOPING_OPTIONS.process_steps_count, 'La cantidad de pasos del proceso no es válida'),
    decision_complexity: scopingOption(SCOPING_OPTIONS.decision_complexity, 'La complejidad de las decisiones no es válida'),
    applications_count: scopingOption(SCOPING_OPTIONS.applications_count, 'La cantidad de aplicaciones no es válida'),
    uses_vdi: z.boolean({ error: 'El indicador de VDI debe ser verdadero o falso' }),
    requires_ocr: z.boolean({ error: 'El indicador de OCR debe ser verdadero o falso' }),
    structured_data_pct: scopingOption(SCOPING_OPTIONS.structured_data_pct, 'El porcentaje de datos estructurados no es válido'),
    exception_rate_pct: scopingPercent('La tasa de excepciones debe ser un número entre 0 y 100').optional(),
    currency: scopingOption(SCOPING_OPTIONS.currency, 'La moneda debe ser CLP, USD o UF').optional(),
    hourly_labor_cost: scopingNonNegative('El costo hora del analista del cliente debe ser un número mayor o igual a cero').optional(),
    target_hourly_rate: scopingNonNegative('La tarifa de venta por hora debe ser un número mayor o igual a cero').optional(),
    internal_cost_rate: scopingNonNegative('El costo interno por hora debe ser un número mayor o igual a cero').optional(),
    custom_hours: scopingCustomHours.nullable().optional()
};

// Datos del levantamiento. Cada campo que el controller lea debe declararse aquí: zod descarta el resto.
const scopingDetailsShape = {
    client_name: scopingRequiredText('El nombre del cliente', 150),
    process_name: scopingRequiredText('El nombre del proceso', 200),
    client_contact: scopingText('contacto del cliente', 150).nullable().optional(),
    client_email: scopingText('correo del cliente', 150).nullable().optional(),
    business_unit: scopingText('unidad de negocio', 100).nullable().optional(),
    process_archetype: z.string({ error: 'El arquetipo del proceso no es válido' }).trim().min(1, 'El arquetipo del proceso no es válido').max(50, 'El arquetipo del proceso no es válido').optional(),
    applications_detail: scopingText('detalle de aplicaciones', 2000).nullable().optional(),
    assumptions: scopingText('supuestos', 5000).nullable().optional(),
    exclusions: scopingText('exclusiones', 5000).nullable().optional(),
    notes: scopingText('notas', 5000).nullable().optional(),
    status: scopingOption(SCOPING_STATUSES, 'El estado del levantamiento no es válido').optional()
};

const scopingCreateShape = { ...scopingDetailsShape, ...scopingInputsShape };

export const calculateScopingSchema = scopingBody(z.object(scopingInputsShape, { error: scopingBodyError }));
export const createScopingSchema = scopingBody(z.object(scopingCreateShape, { error: scopingBodyError }));
// PUT parcial: lo que no llega se conserva del registro guardado (ver ScopingService.update).
export const updateScopingSchema = scopingBody(z.object(scopingCreateShape, { error: scopingBodyError }).partial());