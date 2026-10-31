import { Migration } from './migrations';

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Schema inicial completo',
    up: [
      // Script del schema.sql inicial - tablas principales
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('team_lead', 'rpa_developer', 'rpa_operations', 'it_support')),
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        start_date DATE,
        end_date DATE,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
        budget DECIMAL(10,2),
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE TABLE IF NOT EXISTS task_boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        board_type VARCHAR(20) DEFAULT 'kanban' CHECK (board_type IN ('kanban', 'scrum', 'custom')),
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS task_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        position INTEGER NOT NULL,
        color VARCHAR(7) DEFAULT '#gray',
        is_done_column BOOLEAN DEFAULT 0,
        wip_limit INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL,
        column_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        task_type VARCHAR(20) DEFAULT 'task' CHECK (task_type IN ('task', 'bug', 'feature', 'research', 'documentation')),
        status VARCHAR(20) DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'testing', 'done', 'blocked')),
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
        assignee_id INTEGER,
        reporter_id INTEGER NOT NULL,
        story_points INTEGER,
        estimated_hours DECIMAL(5,2),
        actual_hours DECIMAL(5,2) DEFAULT 0,
        start_date DATETIME,
        due_date DATETIME,
        position INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE,
        FOREIGN KEY (column_id) REFERENCES task_columns(id),
        FOREIGN KEY (assignee_id) REFERENCES users(id),
        FOREIGN KEY (reporter_id) REFERENCES users(id)
      )`,

      `CREATE TABLE IF NOT EXISTS project_milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        milestone_type VARCHAR(50) DEFAULT 'delivery' CHECK (milestone_type IN ('delivery', 'demo', 'review', 'go_live', 'checkpoint', 'deadline')),
        planned_date DATE NOT NULL,
        actual_date DATE,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'delayed', 'cancelled')),
        priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
        responsible_user_id INTEGER,
        completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (responsible_user_id) REFERENCES users(id)
      )`,

      `CREATE TABLE IF NOT EXISTS global_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        setting_type TEXT DEFAULT 'string' CHECK (setting_type IN ('string', 'number', 'decimal', 'boolean')),
        description TEXT,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`
    ]
  },

  {
    version: 2,
    description: 'Agregar soporte para empresas de soporte',
    up: [
      `CREATE TABLE IF NOT EXISTS support_companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        monthly_hours_contracted INTEGER DEFAULT 0,
        hourly_rate DECIMAL(10,2) DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ]
  },

  {
    version: 3,
    description: 'Agregar tabla de tickets de soporte',
    up: [
      `CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        ticket_type TEXT DEFAULT 'support' CHECK (ticket_type IN ('support', 'maintenance', 'development', 'consultation')),
        created_by INTEGER NOT NULL,
        resolver_id INTEGER,
        hours_spent DECIMAL(5,2) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES support_companies(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (resolver_id) REFERENCES users(id)
      )`
    ]
  },

  {
    version: 4,
    description: 'Agregar procesos RPA específicos por empresa',
    up: [
      `CREATE TABLE IF NOT EXISTS support_rpa_processes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        process_name TEXT NOT NULL,
        process_description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES support_companies(id),
        UNIQUE(company_id, process_name)
      )`
    ]
  },

  {
    version: 5,
    description: 'Agregar contactos por empresa',
    up: [
      `CREATE TABLE IF NOT EXISTS support_company_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        contact_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        position TEXT,
        is_primary BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES support_companies(id)
      )`
    ]
  },

  {
    version: 6,
    description: 'Agregar campos de ticket específicos',
    up: [
      `ALTER TABLE support_tickets ADD COLUMN attention_method TEXT DEFAULT 'FreshDesk'`,
      `ALTER TABLE support_tickets ADD COLUMN rpa_process_id INTEGER REFERENCES support_rpa_processes(id)`,
      `ALTER TABLE support_tickets ADD COLUMN contact_id INTEGER REFERENCES support_company_contacts(id)`,
      `ALTER TABLE support_tickets ADD COLUMN work_date DATE`,
      `ALTER TABLE support_tickets ADD COLUMN completion_date DATE`
    ]
  },

  {
    version: 7,
    description: 'Agregar tarifa de horas extra a empresas de soporte',
    up: [
      `ALTER TABLE support_companies ADD COLUMN hourly_rate_extra DECIMAL(10,2) DEFAULT 0`
    ]
  },

  {
    version: 8,
    description: 'Agregar índices para optimización de importación Mermaid',
    up: [
      // Index for project milestones project lookups (used heavily in batch creation)
      `CREATE INDEX IF NOT EXISTS idx_project_milestones_project_id ON project_milestones(project_id)`,

      // Index for milestone date-based queries and sorting
      `CREATE INDEX IF NOT EXISTS idx_project_milestones_planned_date ON project_milestones(planned_date)`,

      // Index for milestone status and date combinations (for dashboard queries)
      `CREATE INDEX IF NOT EXISTS idx_project_milestones_status_date ON project_milestones(status, planned_date)`,

      // Composite index for task board and column operations (position calculations)
      `CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(board_id, column_id)`,

      // Index for task position calculations within columns
      `CREATE INDEX IF NOT EXISTS idx_tasks_column_position ON tasks(column_id, position)`,

      // Index for task date-based queries during Gantt operations
      `CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(start_date, due_date)`,

      // Index for project board relationships (used in board lookups)
      `CREATE INDEX IF NOT EXISTS idx_task_boards_project ON task_boards(project_id)`
    ]
  },

  {
    version: 9,
    description: 'Agregar tabla user_cost_rates para costos de empleados',
    up: [
      `CREATE TABLE IF NOT EXISTS user_cost_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        monthly_cost DECIMAL(10,2) NOT NULL,
        monthly_cost_currency VARCHAR(3) DEFAULT 'CLP' CHECK (monthly_cost_currency IN ('USD', 'CLP', 'UF')),
        hourly_rate DECIMAL(8,2) NOT NULL,
        hourly_rate_currency VARCHAR(3) DEFAULT 'CLP' CHECK (hourly_rate_currency IN ('USD', 'CLP', 'UF')),
        effective_from DATE NOT NULL,
        effective_to DATE,
        is_active BOOLEAN DEFAULT 1,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_user_cost_rates_user ON user_cost_rates(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_cost_rates_active ON user_cost_rates(is_active, effective_from, effective_to)`,

      `CREATE TRIGGER IF NOT EXISTS update_user_cost_rates_timestamp 
        AFTER UPDATE ON user_cost_rates
        BEGIN
          UPDATE user_cost_rates SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`
    ]
  },

  {
    version: 10,
    description: 'Agregar project_pmo_metrics y project_financials con roi_percentage',
    up: [
      `CREATE TABLE IF NOT EXISTS project_pmo_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        planned_hours DECIMAL(8,2) DEFAULT 0,
        planned_start_date DATE,
        planned_end_date DATE,
        planned_budget DECIMAL(12,2) DEFAULT 0,
        actual_hours DECIMAL(8,2) DEFAULT 0,
        actual_start_date DATE,
        actual_end_date DATE,
        actual_cost DECIMAL(12,2) DEFAULT 0,
        completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
        completed_tasks INTEGER DEFAULT 0,
        total_tasks INTEGER DEFAULT 0,
        schedule_variance_days INTEGER DEFAULT 0,
        cost_variance_percentage DECIMAL(5,2) DEFAULT 0,
        scope_variance_percentage DECIMAL(5,2) DEFAULT 0,
        risk_level VARCHAR(10) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        risk_factors TEXT,
        bugs_found INTEGER DEFAULT 0,
        bugs_resolved INTEGER DEFAULT 0,
        client_satisfaction_score INTEGER CHECK (client_satisfaction_score >= 1 AND client_satisfaction_score <= 10),
        team_velocity DECIMAL(5,2) DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`,

      `CREATE TABLE IF NOT EXISTS project_financials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        budgeted_hours DECIMAL(8,2) DEFAULT 0,
        budgeted_cost DECIMAL(12,2) DEFAULT 0,
        budgeted_cost_currency VARCHAR(3) DEFAULT 'CLP' CHECK (budgeted_cost_currency IN ('USD', 'CLP', 'UF')),
        sale_price DECIMAL(12,2),
        sale_price_currency VARCHAR(3) DEFAULT 'CLP' CHECK (sale_price_currency IN ('USD', 'CLP', 'UF')),
        hourly_rate DECIMAL(10,2),
        hourly_rate_currency VARCHAR(3) DEFAULT 'CLP' CHECK (hourly_rate_currency IN ('USD', 'CLP', 'UF')),
        actual_cost DECIMAL(12,2) DEFAULT 0,
        roi_percentage DECIMAL(5,2) DEFAULT 0,
        profit_margin DECIMAL(12,2) DEFAULT 0,
        delay_cost DECIMAL(10,2) DEFAULT 0,
        penalty_cost DECIMAL(10,2) DEFAULT 0,
        delay_days INTEGER DEFAULT 0,
        efficiency_percentage DECIMAL(5,2) DEFAULT 0,
        cost_per_hour DECIMAL(8,2) DEFAULT 0,
        responsible_user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (responsible_user_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`
    ]
  },

  {
    version: 11,
    description: 'Agregar sistema completo de archivos y gestión de documentos',
    up: [
      // Main files table
      `CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_extension VARCHAR(10),
        file_hash VARCHAR(64) NOT NULL,
        uploaded_by INTEGER NOT NULL,
        description TEXT,
        is_public BOOLEAN DEFAULT 0,
        is_deleted BOOLEAN DEFAULT 0,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      )`,

      // File categories for organization and validation
      `CREATE TABLE IF NOT EXISTS file_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        allowed_extensions TEXT NOT NULL,
        max_file_size INTEGER,
        icon VARCHAR(50) DEFAULT 'file',
        color VARCHAR(7) DEFAULT '#6b7280',
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // File associations to link files with entities
      `CREATE TABLE IF NOT EXISTS file_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER NOT NULL,
        association_type VARCHAR(50) DEFAULT 'attachment',
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE(file_id, entity_type, entity_id, association_type)
      )`,

      // File versions for version control
      `CREATE TABLE IF NOT EXISTS file_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        filename VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        uploaded_by INTEGER NOT NULL,
        version_notes TEXT,
        upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        UNIQUE(file_id, version_number)
      )`,

      // File access log for audit and security
      `CREATE TABLE IF NOT EXISTS file_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        access_type VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        access_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Create indexes for better performance
      `CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by)`,
      `CREATE INDEX IF NOT EXISTS idx_files_extension ON files(file_extension)`,
      `CREATE INDEX IF NOT EXISTS idx_files_upload_date ON files(upload_date)`,
      `CREATE INDEX IF NOT EXISTS idx_file_associations_file ON file_associations(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_associations_entity ON file_associations(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_associations_type ON file_associations(association_type)`,
      `CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_versions_upload_date ON file_versions(upload_date)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_file ON file_access_log(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_user ON file_access_log(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_date ON file_access_log(access_date)`,

      // Insert default file categories
      `INSERT OR IGNORE INTO file_categories (name, description, allowed_extensions, max_file_size, icon, color) VALUES 
        ('Imágenes', 'Archivos de imagen como JPEG, PNG, GIF', '["jpg", "jpeg", "png", "gif", "webp", "svg"]', 10485760, 'image', '#10b981'),
        ('Documentos', 'Documentos de texto y presentaciones', '["pdf", "doc", "docx", "ppt", "pptx", "txt", "rtf", "odt"]', 52428800, 'file-text', '#3b82f6'),
        ('Hojas de Cálculo', 'Archivos de hojas de cálculo', '["xls", "xlsx", "csv", "ods"]', 52428800, 'table', '#059669'),
        ('Archivos Comprimidos', 'Archivos ZIP, RAR y otros comprimidos', '["zip", "rar", "7z", "tar", "gz"]', 104857600, 'archive', '#8b5cf6'),
        ('Videos', 'Archivos de video', '["mp4", "avi", "mov", "wmv", "flv", "webm"]', 524288000, 'video', '#ef4444'),
        ('Audio', 'Archivos de audio', '["mp3", "wav", "ogg", "flac", "aac"]', 104857600, 'music', '#f59e0b'),
        ('Código', 'Archivos de código fuente', '["js", "ts", "py", "java", "cpp", "c", "html", "css", "sql", "json", "xml"]', 10485760, 'code', '#6366f1'),
        ('Otros', 'Otros tipos de archivo', '["*"]', 104857600, 'file', '#6b7280')`
    ]
  },

  {
    version: 12,
    description: 'Fix global_settings table schema to match controller expectations',
    up: [
      // Drop existing table if it has wrong schema
      `DROP TABLE IF EXISTS global_settings`,

      // Recreate with correct schema
      `CREATE TABLE global_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        setting_type TEXT DEFAULT 'string' CHECK (setting_type IN ('string', 'number', 'decimal', 'boolean')),
        description TEXT,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`,

      // Insert the required seed data
      `INSERT INTO global_settings (setting_key, setting_value, setting_type, description, updated_by) VALUES 
        ('usd_rate', '925.50', 'decimal', 'Tipo de cambio USD a CLP (actualizar mensualmente)', 1),
        ('uf_rate', '37250.85', 'decimal', 'Valor de la UF en CLP (actualizar mensualmente)', 1),
        ('monthly_hours', '176', 'number', 'Horas laborales mensuales en Chile (44h semanales)', 1),
        ('weekly_hours', '44', 'number', 'Horas laborales semanales en Chile', 1)`,

      // Create index and trigger
      `CREATE INDEX IF NOT EXISTS idx_global_settings_key ON global_settings(setting_key)`,

      `CREATE TRIGGER IF NOT EXISTS update_global_settings_timestamp 
        AFTER UPDATE ON global_settings
        BEGIN
          UPDATE global_settings SET updated_at = CURRENT_TIMESTAMP WHERE setting_key = NEW.setting_key;
        END`
    ]
  },

  {
    version: 13,
    description: 'Sistema de Ciclo de Vida del Proyecto - Project Lifecycle Phases',
    up: [
      // ========================================
      // PROJECT PHASE TEMPLATES
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_phase_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        phase_order INTEGER NOT NULL,
        is_billable BOOLEAN DEFAULT 0,
        is_mandatory BOOLEAN DEFAULT 1,
        estimated_duration_days INTEGER,
        category VARCHAR(30) CHECK (category IN ('pre_sale', 'negotiation', 'pre_development', 'development', 'testing', 'deployment', 'post_deployment')),
        color VARCHAR(7) DEFAULT '#1890ff',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // ========================================
      // PROJECT PHASES (instancias reales)
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        template_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        phase_order INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'blocked')),
        planned_start_date DATE,
        planned_end_date DATE,
        estimated_hours DECIMAL(5,2) DEFAULT 0,
        actual_start_date DATE,
        actual_end_date DATE,
        actual_hours DECIMAL(5,2) DEFAULT 0,
        responsibility VARCHAR(20) DEFAULT 'internal' CHECK (responsibility IN ('internal', 'client', 'external', 'shared')),
        blocking_reason TEXT,
        waiting_for VARCHAR(200),
        is_billable BOOLEAN DEFAULT 0,
        budgeted_cost DECIMAL(10,2) DEFAULT 0,
        actual_cost DECIMAL(10,2) DEFAULT 0,
        client_charge DECIMAL(10,2) DEFAULT 0,
        variance_days INTEGER DEFAULT 0,
        variance_hours DECIMAL(5,2) DEFAULT 0,
        efficiency_percentage DECIMAL(5,2) DEFAULT 100,
        is_critical_path BOOLEAN DEFAULT 0,
        completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (template_id) REFERENCES project_phase_templates(id)
      )`,

      // ========================================
      // PHASE ACTIVITIES (granularidad extrema)
      // ========================================
      `CREATE TABLE IF NOT EXISTS phase_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        activity_type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        start_datetime DATETIME,
        end_datetime DATETIME,
        duration_minutes INTEGER DEFAULT 0,
        calculated_hours DECIMAL(5,2) DEFAULT 0,
        user_id INTEGER NOT NULL,
        is_productive BOOLEAN DEFAULT 1,
        is_billable BOOLEAN DEFAULT 0,
        is_internal BOOLEAN DEFAULT 1,
        responsibility VARCHAR(20) DEFAULT 'internal' CHECK (responsibility IN ('internal', 'client', 'external')),
        notes TEXT,
        tags TEXT,
        has_evidence BOOLEAN DEFAULT 0,
        evidence_description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // ========================================
      // PROJECT DELAYS
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_delays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        phase_id INTEGER,
        delay_type VARCHAR(30) CHECK (delay_type IN ('client_waiting', 'approval_pending', 'information_missing', 'scope_change', 'technical_blocker', 'resource_unavailable', 'external_dependency', 'other')),
        description TEXT NOT NULL,
        responsible_party VARCHAR(20) CHECK (responsible_party IN ('internal', 'client', 'external', 'shared')),
        contact_person VARCHAR(200),
        delay_start_date DATE NOT NULL,
        delay_end_date DATE,
        delay_days INTEGER DEFAULT 0,
        financial_impact DECIMAL(10,2) DEFAULT 0,
        resolution TEXT,
        resolved_by INTEGER,
        has_evidence BOOLEAN DEFAULT 0,
        evidence_notes TEXT,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (phase_id) REFERENCES project_phases(id),
        FOREIGN KEY (resolved_by) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      // ========================================
      // PROJECT SCOPE CHANGES
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_scope_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        phase_id INTEGER,
        change_type VARCHAR(30) CHECK (change_type IN ('scope_increase', 'scope_decrease', 'requirement_change', 'technical_change', 'timeline_extension', 'other')),
        description TEXT NOT NULL,
        reason TEXT NOT NULL,
        requested_by VARCHAR(200),
        hours_impact DECIMAL(5,2) DEFAULT 0,
        cost_impact DECIMAL(10,2) DEFAULT 0,
        timeline_impact_days INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'implemented')),
        approved_by INTEGER,
        approval_date DATE,
        requires_re_quote BOOLEAN DEFAULT 0,
        new_quote_amount DECIMAL(12,2),
        quote_approved BOOLEAN DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (phase_id) REFERENCES project_phases(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      // ========================================
      // INDEXES
      // ========================================
      `CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_phases_status ON project_phases(status)`,
      `CREATE INDEX IF NOT EXISTS idx_project_phases_template ON project_phases(template_id)`,
      `CREATE INDEX IF NOT EXISTS idx_phase_activities_phase ON phase_activities(phase_id)`,
      `CREATE INDEX IF NOT EXISTS idx_phase_activities_project ON phase_activities(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_phase_activities_user ON phase_activities(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_phase_activities_type ON phase_activities(activity_type)`,
      `CREATE INDEX IF NOT EXISTS idx_project_delays_project ON project_delays(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_delays_phase ON project_delays(phase_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_delays_type ON project_delays(delay_type)`,
      `CREATE INDEX IF NOT EXISTS idx_project_delays_responsible ON project_delays(responsible_party)`,
      `CREATE INDEX IF NOT EXISTS idx_scope_changes_project ON project_scope_changes(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_scope_changes_phase ON project_scope_changes(phase_id)`,
      `CREATE INDEX IF NOT EXISTS idx_scope_changes_status ON project_scope_changes(status)`,

      // ========================================
      // TRIGGERS
      // ========================================
      `CREATE TRIGGER IF NOT EXISTS calculate_activity_hours
        AFTER INSERT ON phase_activities
        BEGIN
          UPDATE phase_activities
          SET calculated_hours = CAST(NEW.duration_minutes AS DECIMAL) / 60.0
          WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_phase_hours_on_activity_insert
        AFTER INSERT ON phase_activities
        BEGIN
          UPDATE project_phases
          SET actual_hours = (
            SELECT COALESCE(SUM(calculated_hours), 0)
            FROM phase_activities
            WHERE phase_id = NEW.phase_id
          )
          WHERE id = NEW.phase_id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_phase_hours_on_activity_update
        AFTER UPDATE ON phase_activities
        BEGIN
          UPDATE project_phases
          SET actual_hours = (
            SELECT COALESCE(SUM(calculated_hours), 0)
            FROM phase_activities
            WHERE phase_id = NEW.phase_id
          )
          WHERE id = NEW.phase_id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS calculate_delay_days
        AFTER UPDATE OF delay_end_date ON project_delays
        WHEN NEW.delay_end_date IS NOT NULL
        BEGIN
          UPDATE project_delays
          SET delay_days = CAST(julianday(NEW.delay_end_date) - julianday(NEW.delay_start_date) AS INTEGER)
          WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_project_phases_timestamp
        AFTER UPDATE ON project_phases
        BEGIN
          UPDATE project_phases SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_phase_activities_timestamp
        AFTER UPDATE ON phase_activities
        BEGIN
          UPDATE phase_activities SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_project_delays_timestamp
        AFTER UPDATE ON project_delays
        BEGIN
          UPDATE project_delays SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_scope_changes_timestamp
        AFTER UPDATE ON project_scope_changes
        BEGIN
          UPDATE project_scope_changes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      // ========================================
      // SEED DATA - Phase Templates
      // ========================================
      `INSERT INTO project_phase_templates (name, description, phase_order, is_billable, category, estimated_duration_days, color) VALUES
        ('Discovery Call', 'Primera reunión exploratoria con cliente para entender necesidad', 1, 0, 'pre_sale', 1, '#8c8c8c'),
        ('Process Analysis', 'Análisis profundo del proceso actual (revisión grabaciones, documentos, flujos)', 2, 0, 'pre_sale', 2, '#8c8c8c'),
        ('Technical Feasibility', 'Evaluación técnica de viabilidad de automatización', 3, 0, 'pre_sale', 1, '#8c8c8c'),
        ('Proposal Creation', 'Armado de propuesta técnica y comercial', 4, 0, 'pre_sale', 2, '#8c8c8c'),
        ('Client Review', 'Cliente revisa propuesta (tiempo de espera)', 5, 0, 'negotiation', 5, '#faad14'),
        ('Proposal Adjustments', 'Ajustes de propuesta según feedback cliente', 6, 0, 'negotiation', 1, '#faad14'),
        ('Commercial Negotiation', 'Negociación de precios y condiciones', 7, 0, 'negotiation', 3, '#faad14'),
        ('Contract Signing', 'Firma de contrato (OC/Contrato marco)', 8, 0, 'negotiation', 2, '#faad14'),
        ('PDD Creation', 'Creación del Process Definition Document', 9, 1, 'pre_development', 3, '#f5222d'),
        ('PDD Client Review', 'Cliente revisa y aprueba PDD (espera)', 10, 0, 'pre_development', 5, '#f5222d'),
        ('PDD Signature', 'Firma del PDD por cliente (NO INICIAR SIN ESTO)', 11, 0, 'pre_development', 2, '#f5222d'),
        ('Environment Setup', 'Configuración de ambientes de desarrollo y testing', 12, 1, 'pre_development', 1, '#f5222d'),
        ('Kickoff Meeting', 'Reunión de inicio oficial del proyecto', 13, 1, 'pre_development', 1, '#f5222d'),
        ('Development - Core Logic', 'Desarrollo lógica principal del robot', 14, 1, 'development', 10, '#1890ff'),
        ('Development - Exception Handling', 'Manejo de excepciones y casos borde', 15, 1, 'development', 3, '#1890ff'),
        ('Development - Logging & Monitoring', 'Implementación de logs y monitoreo', 16, 1, 'development', 2, '#1890ff'),
        ('Code Review', 'Revisión de código por peer/líder técnico', 17, 1, 'development', 1, '#1890ff'),
        ('Unit Testing', 'Pruebas unitarias de componentes', 18, 1, 'testing', 2, '#722ed1'),
        ('Integration Testing', 'Pruebas de integración con sistemas', 19, 1, 'testing', 3, '#722ed1'),
        ('UAT Preparation', 'Preparación de casos de prueba para cliente', 20, 1, 'testing', 1, '#722ed1'),
        ('UAT Execution', 'Cliente ejecuta User Acceptance Testing', 21, 1, 'testing', 5, '#722ed1'),
        ('UAT Fixes', 'Correcciones post UAT', 22, 1, 'testing', 3, '#722ed1'),
        ('Production Deployment', 'Despliegue a ambiente productivo', 23, 1, 'deployment', 1, '#52c41a'),
        ('Hypercare Week 1', 'Soporte intensivo primera semana', 24, 1, 'deployment', 7, '#52c41a'),
        ('Knowledge Transfer', 'Transferencia de conocimiento a equipo cliente', 25, 1, 'deployment', 2, '#52c41a'),
        ('Documentation Delivery', 'Entrega de documentación técnica y usuario final', 26, 1, 'deployment', 2, '#52c41a'),
        ('Hypercare Month 1', 'Soporte post go-live mes 1', 27, 1, 'post_deployment', 30, '#13c2c2'),
        ('Final Review', 'Reunión de cierre y lecciones aprendidas', 28, 0, 'post_deployment', 1, '#13c2c2'),
        ('Project Closure', 'Cierre administrativo del proyecto', 29, 0, 'post_deployment', 1, '#13c2c2')`
    ]
  },

  {
    version: 14,
    description: 'Agregar tabla LLM API Keys para configuración de modelos de lenguaje',
    up: [
      `CREATE TABLE IF NOT EXISTS llm_api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider VARCHAR(20) NOT NULL CHECK (provider IN ('openai', 'claude', 'gemini', 'deepseek')),
        api_key_encrypted TEXT NOT NULL,
        selected_model VARCHAR(50),
        is_valid BOOLEAN DEFAULT 0,
        last_validated DATETIME,
        validation_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, provider)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_llm_api_keys_user_provider ON llm_api_keys(user_id, provider)`,
      `CREATE INDEX IF NOT EXISTS idx_llm_api_keys_provider ON llm_api_keys(provider)`,

      `CREATE TRIGGER IF NOT EXISTS update_llm_api_keys_timestamp
        AFTER UPDATE ON llm_api_keys
        BEGIN
          UPDATE llm_api_keys SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`
    ]
  },

  {
    version: 15,
    description: 'Agregar columnas faltantes a la tabla projects',
    up: [
      // Agregar columna priority
      `ALTER TABLE projects ADD COLUMN priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low'))`,

      // Agregar columna assigned_to
      `ALTER TABLE projects ADD COLUMN assigned_to INTEGER REFERENCES users(id)`,

      // Agregar columna actual_start_date
      `ALTER TABLE projects ADD COLUMN actual_start_date DATE`,

      // Agregar columna actual_end_date
      `ALTER TABLE projects ADD COLUMN actual_end_date DATE`,

      // Agregar columna progress_percentage
      `ALTER TABLE projects ADD COLUMN progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100)`
    ]
  },

  {
    version: 16,
    description: 'Agregar tablas faltantes del schema (user_sessions, notifications, activity_log, etc.)',
    up: [
      // ========================================
      // USER SESSIONS - CRÍTICO PARA LOGIN
      // ========================================
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, expires_at)`,

      // ========================================
      // NOTIFICATIONS
      // ========================================
      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(20) DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
        entity_type VARCHAR(20),
        entity_id INTEGER,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)`,

      // ========================================
      // ACTIVITY LOG
      // ========================================
      `CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        entity_type VARCHAR(20) NOT NULL,
        entity_id INTEGER NOT NULL,
        action VARCHAR(50) NOT NULL,
        old_values TEXT,
        new_values TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)`,

      // ========================================
      // COMMENTS
      // ========================================
      `CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('task', 'project', 'issue')),
        entity_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id)`,

      `CREATE TRIGGER IF NOT EXISTS update_comments_timestamp
        AFTER UPDATE ON comments
        BEGIN
          UPDATE comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      // ========================================
      // ATTACHMENTS
      // ========================================
      `CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('task', 'project', 'issue', 'comment')),
        entity_id INTEGER NOT NULL,
        uploaded_by INTEGER NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        is_evidence BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by)`,

      // ========================================
      // TIME ENTRIES
      // ========================================
      `CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_id INTEGER,
        project_id INTEGER,
        description TEXT,
        hours DECIMAL(5,2) NOT NULL CHECK (hours >= 0),
        date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        is_billable BOOLEAN DEFAULT 1,
        hourly_rate DECIMAL(8,2),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,

      `CREATE INDEX IF NOT EXISTS idx_time_entries_user_date ON time_entries(user_id, date)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id)`,

      `CREATE TRIGGER IF NOT EXISTS update_time_entries_timestamp
        AFTER UPDATE ON time_entries
        BEGIN
          UPDATE time_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      // ========================================
      // ISSUES
      // ========================================
      `CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        task_id INTEGER,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        issue_type VARCHAR(20) DEFAULT 'issue' CHECK (issue_type IN ('bug', 'issue', 'impediment', 'risk')),
        severity VARCHAR(10) DEFAULT 'medium' CHECK (severity IN ('critical', 'major', 'minor', 'trivial')),
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'wont_fix')),
        responsibility VARCHAR(20) DEFAULT 'internal' CHECK (responsibility IN ('internal', 'client', 'external', 'shared')),
        financial_impact DECIMAL(10,2) DEFAULT 0,
        delay_days INTEGER DEFAULT 0,
        reported_by INTEGER NOT NULL,
        assigned_to INTEGER,
        resolution TEXT,
        resolved_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (reported_by) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_issues_responsibility ON issues(responsibility)`,
      `CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`,

      `CREATE TRIGGER IF NOT EXISTS update_issues_timestamp
        AFTER UPDATE ON issues
        BEGIN
          UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      // ========================================
      // TASK DEPENDENCIES
      // ========================================
      `CREATE TABLE IF NOT EXISTS task_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        predecessor_id INTEGER NOT NULL,
        successor_id INTEGER NOT NULL,
        dependency_type VARCHAR(20) DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
        lag_days INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (predecessor_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (successor_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(predecessor_id, successor_id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor ON task_dependencies(predecessor_id)`,
      `CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor ON task_dependencies(successor_id)`,

      // ========================================
      // ROI ALERTS
      // ========================================
      `CREATE TABLE IF NOT EXISTS roi_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        alert_level VARCHAR(20) DEFAULT 'warning' CHECK (alert_level IN ('info', 'warning', 'critical')),
        message TEXT NOT NULL,
        threshold_value DECIMAL(10,2),
        current_value DECIMAL(10,2),
        is_resolved BOOLEAN DEFAULT 0,
        resolved_at DATETIME,
        resolved_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (resolved_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_roi_alerts_project ON roi_alerts(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_roi_alerts_type ON roi_alerts(alert_type, alert_level)`,
      `CREATE INDEX IF NOT EXISTS idx_roi_alerts_resolved ON roi_alerts(is_resolved)`,

      // ========================================
      // PROJECT DEPENDENCIES
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_project_id INTEGER NOT NULL,
        dependent_project_id INTEGER NOT NULL,
        dependency_type VARCHAR(30) DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
        description TEXT,
        is_critical BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (dependent_project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(source_project_id, dependent_project_id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_project_dependencies_source ON project_dependencies(source_project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_dependencies_dependent ON project_dependencies(dependent_project_id)`
    ]
  },

  {
    version: 17,
    description: 'Agregar columnas faltantes a la tabla users (avatar_url, last_login)',
    up: [
      // Agregar columna avatar_url
      `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)`,

      // Agregar columna last_login
      `ALTER TABLE users ADD COLUMN last_login DATETIME`
    ]
  },

  {
    version: 18,
    description: 'Crear tabla project_assignments para gestión de múltiples usuarios por proyecto',
    up: [
      // ========================================
      // PROJECT ASSIGNMENTS - Multi-user assignments
      // ========================================
      `CREATE TABLE IF NOT EXISTS project_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role VARCHAR(50) DEFAULT 'contributor' CHECK (role IN ('lead', 'contributor', 'reviewer', 'observer')),
        allocation_percentage INTEGER DEFAULT 100 CHECK (allocation_percentage >= 0 AND allocation_percentage <= 100),
        start_date DATE,
        end_date DATE,
        is_active BOOLEAN DEFAULT 1,
        notes TEXT,
        assigned_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (assigned_by) REFERENCES users(id),
        UNIQUE(project_id, user_id, is_active)
      )`,

      // Indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON project_assignments(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_assignments_active ON project_assignments(is_active)`,

      // Trigger to update timestamp
      `CREATE TRIGGER IF NOT EXISTS update_project_assignments_timestamp
        AFTER UPDATE ON project_assignments
        BEGIN
          UPDATE project_assignments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`
    ]
  },

  {
    version: 19,
    description: 'Agregar columnas faltantes a project_milestones para tracking de delays',
    up: [
      // Add missing columns to project_milestones table
      `ALTER TABLE project_milestones ADD COLUMN impact_on_timeline INTEGER DEFAULT 0`,
      `ALTER TABLE project_milestones ADD COLUMN responsibility VARCHAR(20) DEFAULT 'internal' CHECK (responsibility IN ('internal', 'client', 'external', 'shared'))`,
      `ALTER TABLE project_milestones ADD COLUMN blocking_reason TEXT`,
      `ALTER TABLE project_milestones ADD COLUMN delay_justification TEXT`,
      `ALTER TABLE project_milestones ADD COLUMN external_contact VARCHAR(200)`,
      `ALTER TABLE project_milestones ADD COLUMN estimated_delay_days INTEGER DEFAULT 0`,
      `ALTER TABLE project_milestones ADD COLUMN financial_impact DECIMAL(10,2) DEFAULT 0`,
      `ALTER TABLE project_milestones ADD COLUMN created_by INTEGER REFERENCES users(id)`
    ]
  },

  {
    version: 20,
    description: 'Agregar sistema completo de Ideas con voting y comentarios',
    up: [
      // ========================================
      // IDEAS MANAGEMENT SYSTEM
      // ========================================
      `CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(50) DEFAULT 'general' CHECK (category IN ('automation', 'process_improvement', 'tool_enhancement', 'cost_reduction', 'productivity', 'general')),
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'approved', 'in_progress', 'done', 'rejected')),
        impact_score INTEGER DEFAULT 3 CHECK (impact_score BETWEEN 1 AND 5),
        effort_score INTEGER DEFAULT 3 CHECK (effort_score BETWEEN 1 AND 5),
        priority_score DECIMAL(3,2) DEFAULT 1.0,
        votes_count INTEGER DEFAULT 0,
        created_by INTEGER NOT NULL,
        assigned_to INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      )`,

      // Idea votes
      `CREATE TABLE IF NOT EXISTS idea_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('up', 'down')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(idea_id, user_id),
        FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Idea comments
      `CREATE TABLE IF NOT EXISTS idea_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        comment TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Indexes for performance
      `CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status)`,
      `CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category)`,
      `CREATE INDEX IF NOT EXISTS idx_ideas_created_by ON ideas(created_by)`,
      `CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority_score)`,
      `CREATE INDEX IF NOT EXISTS idx_idea_votes_idea ON idea_votes(idea_id)`,
      `CREATE INDEX IF NOT EXISTS idx_idea_comments_idea ON idea_comments(idea_id)`,

      // Triggers
      `CREATE TRIGGER IF NOT EXISTS update_ideas_timestamp
        AFTER UPDATE ON ideas
        BEGIN
          UPDATE ideas SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_idea_comments_timestamp
        AFTER UPDATE ON idea_comments
        BEGIN
          UPDATE idea_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      // Trigger to calculate priority_score automatically
      `CREATE TRIGGER IF NOT EXISTS calculate_priority_score_insert
        AFTER INSERT ON ideas
        BEGIN
          UPDATE ideas SET priority_score = CAST(NEW.impact_score AS DECIMAL) / CAST(NEW.effort_score AS DECIMAL) WHERE id = NEW.id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS calculate_priority_score_update
        AFTER UPDATE OF impact_score, effort_score ON ideas
        BEGIN
          UPDATE ideas SET priority_score = CAST(NEW.impact_score AS DECIMAL) / CAST(NEW.effort_score AS DECIMAL) WHERE id = NEW.id;
        END`,

      // Trigger to update vote count in ideas
      `CREATE TRIGGER IF NOT EXISTS update_idea_vote_count_insert
        AFTER INSERT ON idea_votes
        BEGIN
          UPDATE ideas SET votes_count = (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = NEW.idea_id AND vote_type = 'up'
          ) - (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = NEW.idea_id AND vote_type = 'down'
          ) WHERE id = NEW.idea_id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_idea_vote_count_update
        AFTER UPDATE ON idea_votes
        BEGIN
          UPDATE ideas SET votes_count = (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = NEW.idea_id AND vote_type = 'up'
          ) - (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = NEW.idea_id AND vote_type = 'down'
          ) WHERE id = NEW.idea_id;
        END`,

      `CREATE TRIGGER IF NOT EXISTS update_idea_vote_count_delete
        AFTER DELETE ON idea_votes
        BEGIN
          UPDATE ideas SET votes_count = (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = OLD.idea_id AND vote_type = 'up'
          ) - (
            SELECT COUNT(*) FROM idea_votes WHERE idea_id = OLD.idea_id AND vote_type = 'down'
          ) WHERE id = OLD.idea_id;
        END`
    ]
  },

  {
    version: 21,
    description: 'Agregar columna end_date a project_milestones para soporte de rangos de fecha',
    up: [
      // Agregar columna end_date si no existe
      `ALTER TABLE project_milestones ADD COLUMN end_date DATE`
    ]
  },

  {
    version: 22,
    description: 'Agregar columna is_active a support_company_contacts para soft delete',
    up: [
      // Agregar columna is_active con default 1 (activo)
      `ALTER TABLE support_company_contacts ADD COLUMN is_active INTEGER DEFAULT 1`
    ]
  },

  {
    version: 23,
    description: 'Agregar columnas faltantes en tablas de Support (id_ticket, is_active)',
    up: [
      // Agregar id_ticket a support_tickets (para identificador legible como SUP-2026-001)
      `ALTER TABLE support_tickets ADD COLUMN id_ticket TEXT`,
      // Agregar is_active a support_rpa_processes para soft delete
      `ALTER TABLE support_rpa_processes ADD COLUMN is_active INTEGER DEFAULT 1`
    ]
  },

  {
    version: 24,
    description: 'Agregar columnas faltantes en support_companies (contracted_hours_monthly, hourly_rate_currency)',
    up: [
      // El código usa contracted_hours_monthly pero la tabla tiene monthly_hours_contracted
      // Agregar la columna con el nombre que usa el código
      `ALTER TABLE support_companies ADD COLUMN contracted_hours_monthly INTEGER DEFAULT 0`,
      // Agregar columna de moneda
      `ALTER TABLE support_companies ADD COLUMN hourly_rate_currency TEXT DEFAULT 'CLP'`
    ]
  },

  {
    version: 25,
    description: 'Fase 1: crear business_areas (RPA/IA, SAP) y asignar area_id a usuarios existentes',
    up: [
      `CREATE TABLE IF NOT EXISTS business_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `INSERT OR IGNORE INTO business_areas (name, code) VALUES ('RPA/IA', 'RPA_IA')`,
      `INSERT OR IGNORE INTO business_areas (name, code) VALUES ('SAP', 'SAP')`,

      `ALTER TABLE users ADD COLUMN area_id INTEGER REFERENCES business_areas(id)`,

      // Todo el equipo actual pertenece a RPA/IA (aún no hay personal de SAP)
      `UPDATE users SET area_id = (SELECT id FROM business_areas WHERE code = 'RPA_IA') WHERE area_id IS NULL`
    ]
  },

  {
    version: 26,
    description: 'Fase 1: crear clients (entidad de cliente unificada), vincular support_companies y agregar columnas que el controller ya esperaba (contact_person, email, phone, address, notes, fechas de contrato)',
    up: [
      `CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(200) NOT NULL,
        tax_id VARCHAR(20),
        contact_person VARCHAR(100),
        email VARCHAR(100),
        phone VARCHAR(50),
        address TEXT,
        notes TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)`,

      // Columnas que supportController.createSupportCompany/updateSupportCompany ya leían y escribían
      // pero no existían en la tabla real (bug pre-existente: la creación de empresas fallaba en runtime)
      `ALTER TABLE support_companies ADD COLUMN client_id INTEGER REFERENCES clients(id)`,
      `ALTER TABLE support_companies ADD COLUMN contact_person TEXT`,
      `ALTER TABLE support_companies ADD COLUMN email TEXT`,
      `ALTER TABLE support_companies ADD COLUMN phone TEXT`,
      `ALTER TABLE support_companies ADD COLUMN address TEXT`,
      `ALTER TABLE support_companies ADD COLUMN notes TEXT`,
      `ALTER TABLE support_companies ADD COLUMN contract_start_date DATE`,
      `ALTER TABLE support_companies ADD COLUMN contract_end_date DATE`,
      `ALTER TABLE support_companies ADD COLUMN created_by INTEGER REFERENCES users(id)`,

      // Un cliente por cada empresa de soporte real ya existente
      `INSERT INTO clients (name, contact_person, email, phone, is_active)
        SELECT company_name, NULL, contact_email, contact_phone, 1 FROM support_companies`,

      `UPDATE support_companies SET client_id = (
        SELECT c.id FROM clients c WHERE c.name = support_companies.company_name LIMIT 1
      ) WHERE client_id IS NULL`
    ]
  },

  {
    version: 27,
    description: 'Fase 1: extender projects con area_id, client_id, project_type, pm_user_id y currency',
    up: [
      `ALTER TABLE projects ADD COLUMN area_id INTEGER REFERENCES business_areas(id)`,
      `ALTER TABLE projects ADD COLUMN client_id INTEGER REFERENCES clients(id)`,
      `ALTER TABLE projects ADD COLUMN project_type VARCHAR(20) DEFAULT 'commercial' CHECK (project_type IN ('internal', 'commercial'))`,
      `ALTER TABLE projects ADD COLUMN pm_user_id INTEGER REFERENCES users(id)`,
      `ALTER TABLE projects ADD COLUMN currency VARCHAR(3) DEFAULT 'CLP'`,

      // Los 5 proyectos reales de hoy son comerciales y del área RPA/IA
      `UPDATE projects SET area_id = (SELECT id FROM business_areas WHERE code = 'RPA_IA') WHERE area_id IS NULL`,
      `UPDATE projects SET project_type = 'commercial' WHERE project_type IS NULL`,

      // Vincular por nombre: el proyecto "AGROSUPER - Toma de Control" contiene el nombre del cliente "AGROSUPER"
      `UPDATE projects SET client_id = (
        SELECT c.id FROM clients c WHERE projects.name LIKE '%' || c.name || '%' LIMIT 1
      ) WHERE client_id IS NULL`
    ]
  },

  {
    version: 28,
    description: 'Fase 1: crear exchange_rates (histórico por fecha, reemplaza el valor único de global_settings) y project_baselines (línea base, se usa desde Fase 4)',
    up: [
      `CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        currency VARCHAR(3) NOT NULL CHECK (currency IN ('USD', 'UF')),
        rate_date DATE NOT NULL,
        rate_to_clp DECIMAL(14,4) NOT NULL,
        source VARCHAR(50) DEFAULT 'manual',
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(currency, rate_date)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency, rate_date DESC)`,

      // Se migra el valor único que vivía en global_settings como el primer punto de la serie histórica.
      // OJO: son los mismos valores que ya estaban configurados, no cifras nuevas verificadas.
      `INSERT OR IGNORE INTO exchange_rates (currency, rate_date, rate_to_clp, source)
        SELECT 'USD', date('now'), CAST(setting_value AS DECIMAL), 'migrated_from_global_settings'
        FROM global_settings WHERE setting_key = 'usd_rate'`,
      `INSERT OR IGNORE INTO exchange_rates (currency, rate_date, rate_to_clp, source)
        SELECT 'UF', date('now'), CAST(setting_value AS DECIMAL), 'migrated_from_global_settings'
        FROM global_settings WHERE setting_key = 'uf_rate'`,

      `CREATE TABLE IF NOT EXISTS project_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        baseline_date DATE NOT NULL DEFAULT (date('now')),
        start_date DATE,
        end_date DATE,
        budget DECIMAL(12,2),
        budgeted_hours DECIMAL(8,2),
        is_current BOOLEAN DEFAULT 1,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, version)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_project_baselines_project ON project_baselines(project_id)`
    ]
  },

  {
    version: 29,
    description: 'Fase 2: crear payment_milestones, invoices, invoice_lines y payments (cobros e hitos de pago)',
    up: [
      `CREATE TABLE IF NOT EXISTS payment_milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        project_milestone_id INTEGER,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP', 'USD', 'UF')),
        trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('date', 'progress_pct', 'deliverable_approved')),
        trigger_value DECIMAL(5,2),
        planned_date DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'billable', 'invoiced', 'paid', 'overdue')),
        billable_at DATETIME,
        sort_order INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (project_milestone_id) REFERENCES project_milestones(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_payment_milestones_project ON payment_milestones(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payment_milestones_status ON payment_milestones(status)`,

      `CREATE TRIGGER IF NOT EXISTS update_payment_milestones_timestamp
        AFTER UPDATE ON payment_milestones
        BEGIN
          UPDATE payment_milestones SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        invoice_number VARCHAR(50) NOT NULL UNIQUE,
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP', 'USD', 'UF')),
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled')),
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`,

      `CREATE TRIGGER IF NOT EXISTS update_invoices_timestamp
        AFTER UPDATE ON invoices
        BEGIN
          UPDATE invoices SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `CREATE TABLE IF NOT EXISTS invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        payment_milestone_id INTEGER,
        description VARCHAR(300) NOT NULL,
        amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (payment_milestone_id) REFERENCES payment_milestones(id) ON DELETE SET NULL
      )`,

      `CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id)`,

      `CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP', 'USD', 'UF')),
        payment_date DATE NOT NULL,
        method VARCHAR(50),
        reference VARCHAR(100),
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)`
    ]
  },

  {
    version: 30,
    description: 'Fase 3: timesheet_periods + columnas de aprobación/bloqueo en time_entries (tiempo confiable y efectividad)',
    up: [
      `CREATE TABLE IF NOT EXISTS timesheet_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'approved', 'rejected')),
        submitted_at DATETIME,
        approved_by INTEGER,
        approved_at DATETIME,
        rejection_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        UNIQUE(user_id, period_start)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_timesheet_periods_user ON timesheet_periods(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_timesheet_periods_status ON timesheet_periods(status)`,

      `CREATE TRIGGER IF NOT EXISTS update_timesheet_periods_timestamp
        AFTER UPDATE ON timesheet_periods
        BEGIN
          UPDATE timesheet_periods SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`,

      `ALTER TABLE time_entries ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'submitted', 'approved', 'rejected'))`,
      `ALTER TABLE time_entries ADD COLUMN timesheet_period_id INTEGER REFERENCES timesheet_periods(id)`,
      `ALTER TABLE time_entries ADD COLUMN approved_by INTEGER REFERENCES users(id)`,
      `ALTER TABLE time_entries ADD COLUMN approved_at DATETIME`,
      `ALTER TABLE time_entries ADD COLUMN cost_rate_snapshot DECIMAL(10,2)`,
      `ALTER TABLE time_entries ADD COLUMN bill_rate_snapshot DECIMAL(10,2)`,
      `ALTER TABLE time_entries ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT 0`,

      `CREATE INDEX IF NOT EXISTS idx_time_entries_approval_status ON time_entries(approval_status)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_period ON time_entries(timesheet_period_id)`
    ]
  },

  {
    version: 31,
    description: 'Agregar project_baselines y baseline_planned_date en project_milestones (Fase 4 - desvíos y salud del proyecto)',
    up: [
      `DROP TABLE IF EXISTS project_baselines`,

      `CREATE TABLE IF NOT EXISTS project_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL UNIQUE,
        baseline_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        budgeted_cost_clp DECIMAL(12,2) NOT NULL DEFAULT 0,
        budgeted_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_project_baselines_project ON project_baselines(project_id)`,

      `ALTER TABLE project_milestones ADD COLUMN baseline_planned_date DATE`
    ]
  },

  {
    version: 32,
    description: 'Notificaciones in-app: link, sender_id, event_key en notifications (Fase 5)',
    up: [
      `ALTER TABLE notifications ADD COLUMN link VARCHAR(255)`,
      `ALTER TABLE notifications ADD COLUMN sender_id INTEGER REFERENCES users(id)`,
      `ALTER TABLE notifications ADD COLUMN event_key VARCHAR(40)`,

      `CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(user_id, event_key, entity_id)`
    ]
  },

  {
    version: 33,
    description: 'Subtareas (checklist liviano) para tasks - Fase 5',
    up: [
      `CREATE TABLE IF NOT EXISTS task_subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        is_done BOOLEAN NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON task_subtasks(task_id)`
    ]
  },

  {
    version: 34,
    description: 'Etiquetas de texto libre para tasks - Fase 5',
    up: [
      `CREATE TABLE IF NOT EXISTS task_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        tag VARCHAR(50) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE (task_id, tag)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id)`
    ]
  },

  {
    version: 35,
    description: 'Colaboradores adicionales en tasks (multi-asignados aditivo) - Fase 5',
    up: [
      `CREATE TABLE IF NOT EXISTS task_collaborators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE (task_id, user_id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_collaborators_task ON task_collaborators(task_id)`
    ]
  },

  {
    version: 36,
    description: 'Multi-asignado completo: lista de responsables por tarea (task_assignees) - Fase 5',
    up: [
      `CREATE TABLE IF NOT EXISTS task_assignees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE (task_id, user_id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id)`,

      `INSERT OR IGNORE INTO task_assignees (task_id, user_id) SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL`
    ]
  },

  {
    version: 37,
    description: 'Corrige monthly_hours/weekly_hours en global_settings (168h = 42h x 4 semanas) - Fase 6a',
    up: [
      `INSERT INTO global_settings (setting_key, setting_value, setting_type)
       VALUES ('monthly_hours', '168', 'number')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = '168'`,

      `INSERT INTO global_settings (setting_key, setting_value, setting_type)
       VALUES ('weekly_hours', '42', 'number')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = '42'`
    ]
  },

  {
    version: 38,
    description: 'Ciclo comercial y controles PMO: cotizaciones, reuniones, OC/HES, cierres y capacidad presupuestada',
    up: [
      `CREATE TABLE IF NOT EXISTS client_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id),
        name TEXT NOT NULL,
        position TEXT,
        email TEXT,
        phone TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts(client_id, is_active)`,
      `CREATE TABLE IF NOT EXISTS sales_reps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS project_quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        pricing_model TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_model IN ('fixed', 'hourly', 'mixed')),
        amount DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
        currency TEXT NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP', 'UF', 'USD')),
        hours DECIMAL(10,2),
        hourly_rate DECIMAL(14,2),
        estimated_cost DECIMAL(14,2),
        margin_percent DECIMAL(7,2),
        status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'replaced')),
        scope_change_id INTEGER REFERENCES project_scope_changes(id) ON DELETE SET NULL,
        file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by INTEGER REFERENCES users(id),
        approved_at DATETIME,
        UNIQUE(project_id, version)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_quotes_project ON project_quotes(project_id, version DESC)`,
      `ALTER TABLE projects ADD COLUMN sales_rep_id INTEGER REFERENCES sales_reps(id)`,
      `ALTER TABLE projects ADD COLUMN client_contact_id INTEGER REFERENCES client_contacts(id)`,
      `ALTER TABLE projects ADD COLUMN opportunity_source TEXT NOT NULL DEFAULT 'direct' CHECK (opportunity_source IN ('sales', 'direct'))`,
      `ALTER TABLE projects ADD COLUMN commercial_stage TEXT NOT NULL DEFAULT 'quoting' CHECK (commercial_stage IN ('quoting', 'approved', 'lost'))`,
      `ALTER TABLE projects ADD COLUMN client_approved_at DATETIME`,
      `UPDATE projects SET commercial_stage = 'approved', client_approved_at = COALESCE(client_approved_at, created_at)`,
      `ALTER TABLE project_assignments ADD COLUMN budgeted_hours DECIMAL(10,2)`,
      `ALTER TABLE project_assignments ADD COLUMN allocation_start_date DATE`,
      `ALTER TABLE project_assignments ADD COLUMN allocation_end_date DATE`,
      `ALTER TABLE projects ADD COLUMN require_purchase_order BOOLEAN NOT NULL DEFAULT 0`,
      `ALTER TABLE projects ADD COLUMN require_service_acceptance BOOLEAN NOT NULL DEFAULT 0`,
      `ALTER TABLE projects ADD COLUMN delivery_accepted_at DATETIME`,
      `ALTER TABLE projects ADD COLUMN delivery_accepted_by INTEGER REFERENCES users(id)`,
      `ALTER TABLE projects ADD COLUMN financial_closed_at DATETIME`,
      `ALTER TABLE projects ADD COLUMN loss_reason TEXT`,
      `CREATE TABLE IF NOT EXISTS project_meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        meeting_date DATETIME NOT NULL,
        summary TEXT NOT NULL,
        escalation_reason TEXT,
        next_commitment TEXT,
        has_pdd BOOLEAN NOT NULL DEFAULT 0,
        has_technical_commercial_proposal BOOLEAN NOT NULL DEFAULT 0,
        evidence_reference TEXT,
        evidence_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_meetings_project ON project_meetings(project_id, meeting_date)`,
      `CREATE TABLE IF NOT EXISTS project_commercial_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL CHECK (document_type IN ('purchase_order', 'service_acceptance', 'client_approval', 'pdd', 'technical_commercial_proposal')),
        reference_number TEXT,
        document_date DATE,
        file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_commercial_documents_project ON project_commercial_documents(project_id, document_type)`,
      `CREATE TABLE IF NOT EXISTS notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scheduled_for DATE NOT NULL,
        notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_key, entity_type, entity_id, user_id, scheduled_for)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(scheduled_for, event_key)`
    ]
  },
  {
    version: 39,
    description: 'Completa columnas comerciales y de capacidad ausentes en bases que ya registraron la migración 38',
    up: [],
    run: async (database) => {
      const addMissingColumns = async (
        table: 'projects' | 'project_assignments' | 'project_meetings' | 'project_commercial_documents',
        columnsToAdd: Array<[string, string]>
      ) => {
        const existingColumns = await new Promise<Set<string>>((resolve, reject) => {
          database.all(`PRAGMA table_info(${table})`, (error, rows: Array<{ name: string }>) => {
            if (error) reject(error);
            else resolve(new Set(rows.map((row) => row.name)));
          });
        });

        for (const [column, definition] of columnsToAdd) {
          if (existingColumns.has(column)) continue;
          await new Promise<void>((resolve, reject) => {
            database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          existingColumns.add(column);
        }
      };

      await addMissingColumns('projects', [
        ['sales_rep_id', 'INTEGER REFERENCES sales_reps(id)'],
        ['client_contact_id', 'INTEGER REFERENCES client_contacts(id)'],
        ['opportunity_source', "TEXT NOT NULL DEFAULT 'direct' CHECK (opportunity_source IN ('sales', 'direct'))"],
        ['commercial_stage', "TEXT NOT NULL DEFAULT 'quoting' CHECK (commercial_stage IN ('quoting', 'approved', 'lost'))"],
        ['client_approved_at', 'DATETIME'],
        ['require_purchase_order', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['require_service_acceptance', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['delivery_accepted_at', 'DATETIME'],
        ['delivery_accepted_by', 'INTEGER REFERENCES users(id)'],
        ['financial_closed_at', 'DATETIME'],
        ['loss_reason', 'TEXT']
      ]);

      await addMissingColumns('project_assignments', [
        ['budgeted_hours', 'DECIMAL(10,2)'],
        ['allocation_start_date', 'DATE'],
        ['allocation_end_date', 'DATE']
      ]);

      // Version 38 was previously recorded in existing databases before its
      // commercial DDL was amended. Repair the affected tables as well as the
      // project columns so the first meeting/document write remains compatible.
      await addMissingColumns('project_meetings', [
        ['escalation_reason', 'TEXT'],
        ['next_commitment', 'TEXT'],
        ['has_pdd', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['has_technical_commercial_proposal', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['evidence_reference', 'TEXT'],
        ['evidence_file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);

      await addMissingColumns('project_commercial_documents', [
        ['reference_number', 'TEXT'],
        ['document_date', 'DATE'],
        ['file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['notes', 'TEXT'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);

      await new Promise<void>((resolve, reject) => {
        database.exec(`UPDATE projects SET opportunity_source = 'sales' WHERE sales_rep_id IS NOT NULL`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  },
  {
    version: 40,
    description: 'Completa columnas de trazabilidad comercial en bases existentes',
    up: [],
    run: async (database) => {
      const addMissingColumns = async (
        table: 'project_meetings' | 'project_commercial_documents' | 'project_quotes',
        columnsToAdd: Array<[string, string]>
      ) => {
        const existingColumns = await new Promise<Set<string>>((resolve, reject) => {
          database.all(`PRAGMA table_info(${table})`, (error, rows: Array<{ name: string }>) => {
            if (error) reject(error);
            else resolve(new Set(rows.map((row) => row.name)));
          });
        });

        for (const [column, definition] of columnsToAdd) {
          if (existingColumns.has(column)) continue;
          await new Promise<void>((resolve, reject) => {
            database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          existingColumns.add(column);
        }
      };

      await addMissingColumns('project_meetings', [
        ['escalation_reason', 'TEXT'],
        ['next_commitment', 'TEXT'],
        ['has_pdd', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['has_technical_commercial_proposal', 'BOOLEAN NOT NULL DEFAULT 0'],
        ['evidence_reference', 'TEXT'],
        ['evidence_file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);

      await addMissingColumns('project_commercial_documents', [
        ['reference_number', 'TEXT'],
        ['document_date', 'DATE'],
        ['file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['notes', 'TEXT'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);

      await addMissingColumns('project_quotes', [
        ['pricing_model', "TEXT NOT NULL DEFAULT 'fixed'"],
        ['amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0'],
        ['currency', "TEXT NOT NULL DEFAULT 'CLP'"],
        ['hours', 'DECIMAL(10,2)'],
        ['hourly_rate', 'DECIMAL(14,2)'],
        ['estimated_cost', 'DECIMAL(14,2)'],
        ['margin_percent', 'DECIMAL(7,2)'],
        ['status', "TEXT NOT NULL DEFAULT 'sent'"],
        ['scope_change_id', 'INTEGER REFERENCES project_scope_changes(id) ON DELETE SET NULL'],
        ['file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['notes', 'TEXT'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
        ['approved_at', 'DATETIME'],
        ['approved_by', 'INTEGER REFERENCES users(id)']
      ]);
    }
  },
  {
    version: 41,
    description: 'Completa columnas de cotizaciones comerciales en bases existentes',
    up: [],
    run: async (database) => {
      const existingColumns = await new Promise<Set<string>>((resolve, reject) => {
        database.all('PRAGMA table_info(project_quotes)', (error, rows: Array<{ name: string }>) => {
          if (error) reject(error);
          else resolve(new Set(rows.map((row) => row.name)));
        });
      });

      const columnsToAdd: Array<[string, string]> = [
        ['pricing_model', "TEXT NOT NULL DEFAULT 'fixed'"],
        ['amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0'],
        ['currency', "TEXT NOT NULL DEFAULT 'CLP'"],
        ['hours', 'DECIMAL(10,2)'],
        ['hourly_rate', 'DECIMAL(14,2)'],
        ['estimated_cost', 'DECIMAL(14,2)'],
        ['margin_percent', 'DECIMAL(7,2)'],
        ['status', "TEXT NOT NULL DEFAULT 'sent'"],
        ['scope_change_id', 'INTEGER REFERENCES project_scope_changes(id) ON DELETE SET NULL'],
        ['file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL'],
        ['notes', 'TEXT'],
        ['created_by', 'INTEGER REFERENCES users(id)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
        ['approved_by', 'INTEGER REFERENCES users(id)'],
        ['approved_at', 'DATETIME']
      ];

      for (const [column, definition] of columnsToAdd) {
        if (existingColumns.has(column)) continue;
        await new Promise<void>((resolve, reject) => {
          database.exec(`ALTER TABLE project_quotes ADD COLUMN ${column} ${definition}`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        existingColumns.add(column);
      }
    }
  },
  {
    version: 42,
    description: 'Bitácora inmutable del proyecto (hitos técnicos, aprobaciones, decisiones, cambios de alcance, incidentes) - Fase 6E',
    up: [
      `CREATE TABLE IF NOT EXISTS project_log_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('technical_milestone', 'client_approval', 'decision', 'scope_change', 'incident')),
        description TEXT NOT NULL,
        file_id INTEGER,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_log_entries_project ON project_log_entries(project_id)`
    ]
  },
  {
    version: 43,
    description: 'Agregar rol billing al CHECK de usuarios - Fase 6D',
    disableForeignKeys: true,
    up: [
      `CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('team_lead', 'rpa_developer', 'rpa_operations', 'it_support', 'billing')),
        full_name VARCHAR(100) NOT NULL,
        avatar_url VARCHAR(255),
        is_active BOOLEAN DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        area_id INTEGER REFERENCES business_areas(id)
      )`,
      `INSERT INTO users_new (id, username, email, password_hash, role, full_name, avatar_url, is_active, last_login, created_at, updated_at, area_id)
       SELECT id, username, email, password_hash, role, full_name, avatar_url, is_active, last_login, created_at, updated_at, area_id
       FROM users`,
      `DROP TABLE users`,
      `ALTER TABLE users_new RENAME TO users`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
      `CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
        AFTER UPDATE ON users
        BEGIN
          UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END`
    ]
  }
,
  {
    version: 44,
    description: 'Restore per-user LLM reasoning preferences without replacing credentials',
    up: [],
    run: async (database) => {
      const columns = await new Promise<Array<{name: string}>>((resolve, reject) => {
        database.all('PRAGMA table_info(llm_api_keys)', (error, rows: Array<{name: string}>) => error ? reject(error) : resolve(rows));
      });
      if (!columns.some(column => column.name === 'reasoning_effort')) {
        await new Promise<void>((resolve, reject) => {
          database.exec('ALTER TABLE llm_api_keys ADD COLUMN reasoning_effort TEXT', error => error ? reject(error) : resolve());
        });
      }
    }
  },
  {
    version: 45,
    description: 'Registro de consumo y costo estimado de IA',
    up: [
      `CREATE TABLE IF NOT EXISTS llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_tokens INTEGER,
        reasoning_tokens INTEGER,
        cost_usd REAL,
        pricing_snapshot TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_llm_usage_user_date ON llm_usage(user_id, created_at)'
    ]
  },
  {
    version: 46,
    description: 'Centros de costos de la empresa (Chile, Peru, USA), imputación comercial y trazabilidad de facturación',
    up: [
      `CREATE TABLE IF NOT EXISTS cost_centers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        country VARCHAR(10) NOT NULL CHECK (country IN ('CHILE', 'PERU', 'USA')),
        category VARCHAR(50) NOT NULL,
        is_rpa BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cost_centers_country ON cost_centers(country)`,
      `CREATE INDEX IF NOT EXISTS idx_cost_centers_is_rpa ON cost_centers(is_rpa)`,
      `CREATE TABLE IF NOT EXISTS project_cost_center_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        quote_id INTEGER REFERENCES project_quotes(id) ON DELETE SET NULL,
        cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
        amount DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
        percentage DECIMAL(5,2),
        currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pcca_project ON project_cost_center_allocations(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pcca_cost_center ON project_cost_center_allocations(cost_center_id)`
    ],
    run: async (database) => {
      // 1. Agregar cost_center_id a payment_milestones si no existe
      const milestoneCols = await new Promise<Array<{ name: string }>>((resolve, reject) => {
        database.all('PRAGMA table_info(payment_milestones)', (err, rows: any) => err ? reject(err) : resolve(rows));
      });
      if (!milestoneCols.some((col) => col.name === 'cost_center_id')) {
        await new Promise<void>((resolve, reject) => {
          database.exec('ALTER TABLE payment_milestones ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL', (err) => err ? reject(err) : resolve());
        });
      }

      // 2. Agregar cost_center_id a invoice_lines si no existe
      const invoiceLineCols = await new Promise<Array<{ name: string }>>((resolve, reject) => {
        database.all('PRAGMA table_info(invoice_lines)', (err, rows: any) => err ? reject(err) : resolve(rows));
      });
      if (!invoiceLineCols.some((col) => col.name === 'cost_center_id')) {
        await new Promise<void>((resolve, reject) => {
          database.exec('ALTER TABLE invoice_lines ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id) ON DELETE SET NULL', (err) => err ? reject(err) : resolve());
        });
      }

      // 3. Seed de los 28 Centros de Costos
      const cecos = [
        // CHILE
        { code: 'E-MONTEL', name: 'Entel Monitoreo Telco', country: 'CHILE', category: 'ENTEL', is_rpa: 0 },
        { code: 'E-MONTI', name: 'Entel Monitoreo TI', country: 'CHILE', category: 'ENTEL', is_rpa: 0 },
        { code: 'E-OUTS', name: 'Entel Outsourcing', country: 'CHILE', category: 'OUTSOURCING', is_rpa: 0 },
        { code: 'E-MESA', name: 'Entel Mesa Ayuda', country: 'CHILE', category: 'ENTEL', is_rpa: 0 },
        { code: 'E-RESI', name: 'Entel Residentes', country: 'CHILE', category: 'ENTEL', is_rpa: 0 },
        { code: 'SAP', name: 'Consultoría SAP', country: 'CHILE', category: 'SAP', is_rpa: 0 },
        { code: 'RPA-S', name: 'RPA Soporte', country: 'CHILE', category: 'RPA', is_rpa: 1 },
        { code: 'RPA-L', name: 'RPA Licencias', country: 'CHILE', category: 'RPA', is_rpa: 1 },
        { code: 'RPA-P', name: 'RPA Proyectos', country: 'CHILE', category: 'RPA', is_rpa: 1 },
        { code: 'SAAS', name: 'Servicios SAAS', country: 'CHILE', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'DSOFT', name: 'Desarrollos de software', country: 'CHILE', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'ARRIENDOS', name: 'Arriendo de Espacios', country: 'CHILE', category: 'FACILITIES', is_rpa: 0 },
        { code: 'O-OUTS', name: 'Otros Outsourcing', country: 'CHILE', category: 'OUTSOURCING', is_rpa: 0 },

        // PERU
        { code: 'P-E-OUTS', name: 'Entel Outsourcing', country: 'PERU', category: 'OUTSOURCING', is_rpa: 0 },
        { code: 'P-SAP', name: 'Consultoría SAP', country: 'PERU', category: 'SAP', is_rpa: 0 },
        { code: 'P-RPA-S', name: 'RPA Soporte', country: 'PERU', category: 'RPA', is_rpa: 1 },
        { code: 'P-RPA-L', name: 'RPA Licencias', country: 'PERU', category: 'RPA', is_rpa: 1 },
        { code: 'P-RPA-P', name: 'RPA Proyectos', country: 'PERU', category: 'RPA', is_rpa: 1 },
        { code: 'P-SAAS', name: 'Servicios SAAS', country: 'PERU', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'P-DSOFT', name: 'Desarrollos de software', country: 'PERU', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'P-O-OUTS', name: 'Otros Outsourcing', country: 'PERU', category: 'OUTSOURCING', is_rpa: 0 },

        // USA
        { code: 'U-SAP', name: 'Consultoría SAP', country: 'USA', category: 'SAP', is_rpa: 0 },
        { code: 'U-RPA-S', name: 'RPA Soporte', country: 'USA', category: 'RPA', is_rpa: 1 },
        { code: 'U-RPA-L', name: 'RPA Licencias', country: 'USA', category: 'RPA', is_rpa: 1 },
        { code: 'U-RPA-P', name: 'RPA Proyectos', country: 'USA', category: 'RPA', is_rpa: 1 },
        { code: 'U-SAAS', name: 'Servicios SAAS', country: 'USA', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'U-DSOFT', name: 'Desarrollos de software', country: 'USA', category: 'SOFTWARE', is_rpa: 0 },
        { code: 'U-OUTS', name: 'Outsourcing', country: 'USA', category: 'OUTSOURCING', is_rpa: 0 }
      ];

      for (const ceco of cecos) {
        await new Promise<void>((resolve, reject) => {
          database.run(
            `INSERT OR IGNORE INTO cost_centers (code, name, country, category, is_rpa, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [ceco.code, ceco.name, ceco.country, ceco.category, ceco.is_rpa],
            (err) => err ? reject(err) : resolve()
          );
        });
      }
    }
  },
  {
    version: 47,
    description: 'Cotizador de RPA, protocolo de levantamiento de 15 minutos, scoring de viabilidad y cubicación de esfuerzo',
    up: [
      `CREATE TABLE IF NOT EXISTS scoping_quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code VARCHAR(50) UNIQUE NOT NULL,
        client_name VARCHAR(150) NOT NULL,
        client_contact VARCHAR(150),
        client_email VARCHAR(150),
        process_name VARCHAR(200) NOT NULL,
        business_unit VARCHAR(100),
        process_archetype VARCHAR(50) NOT NULL DEFAULT 'custom',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        data_input_type VARCHAR(40) NOT NULL,
        rule_based_level VARCHAR(40) NOT NULL,
        process_stability VARCHAR(40) NOT NULL,
        application_stability VARCHAR(40) NOT NULL,
        frequency VARCHAR(30) NOT NULL,
        volume_per_frequency INTEGER NOT NULL DEFAULT 1,
        aht_minutes DECIMAL(8,2) NOT NULL DEFAULT 10,
        current_ftes DECIMAL(6,2) DEFAULT 1,
        error_rate_pct DECIMAL(5,2) DEFAULT 5,
        peak_period VARCHAR(40) DEFAULT 'regular_peak',
        process_steps_count VARCHAR(30) NOT NULL,
        decision_complexity VARCHAR(30) NOT NULL,
        applications_count VARCHAR(30) NOT NULL,
        applications_detail TEXT,
        uses_vdi BOOLEAN NOT NULL DEFAULT 0,
        requires_ocr BOOLEAN NOT NULL DEFAULT 0,
        structured_data_pct VARCHAR(30) NOT NULL,
        exception_rate_pct DECIMAL(5,2) DEFAULT 3,

        viability_status VARCHAR(30) NOT NULL,
        viability_score DECIMAL(4,2) NOT NULL,
        complexity_score DECIMAL(4,2) NOT NULL,
        difficulty_score DECIMAL(4,2) NOT NULL,
        effort_level VARCHAR(20) NOT NULL,
        benefit_level VARCHAR(20) NOT NULL,
        annual_manual_hours INTEGER NOT NULL,
        hours_saved_annual INTEGER NOT NULL,
        ftes_released DECIMAL(6,2) NOT NULL,
        error_reduction_pct INTEGER NOT NULL,
        aht_reduction_pct INTEGER NOT NULL,

        estimated_weeks INTEGER NOT NULL DEFAULT 6,
        hours_pm INTEGER NOT NULL DEFAULT 24,
        hours_consultant INTEGER NOT NULL DEFAULT 54,
        hours_developer INTEGER NOT NULL DEFAULT 140,
        hours_advisor INTEGER NOT NULL DEFAULT 18,
        total_hours INTEGER NOT NULL DEFAULT 236,

        currency VARCHAR(5) NOT NULL DEFAULT 'CLP',
        hourly_labor_cost DECIMAL(12,2) NOT NULL DEFAULT 14000,
        target_hourly_rate DECIMAL(12,2) NOT NULL DEFAULT 36000,
        internal_cost_rate DECIMAL(12,2) NOT NULL DEFAULT 18000,
        project_internal_cost DECIMAL(14,2) NOT NULL,
        proposed_price DECIMAL(14,2) NOT NULL,
        projected_margin_pct DECIMAL(5,2) NOT NULL,
        client_annual_manual_cost DECIMAL(14,2) NOT NULL,
        client_annual_savings DECIMAL(14,2) NOT NULL,
        payback_months DECIMAL(6,1) NOT NULL,
        roi_first_year_pct DECIMAL(6,1) NOT NULL,

        assumptions TEXT,
        exclusions TEXT,
        notes TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent_to_client', 'approved', 'rejected', 'converted_to_project')),
        converted_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_scoping_client ON scoping_quotations(client_name)`,
      `CREATE INDEX IF NOT EXISTS idx_scoping_status ON scoping_quotations(status)`,
      `CREATE INDEX IF NOT EXISTS idx_scoping_archetype ON scoping_quotations(process_archetype)`,
      `CREATE INDEX IF NOT EXISTS idx_scoping_created ON scoping_quotations(created_at DESC)`
    ]
  },
  {
    version: 48,
    description: 'Cotizador de RPA: persistir la calibración manual de horas (custom_hours_json; NULL = sin calibración)',
    up: [
      `ALTER TABLE scoping_quotations ADD COLUMN custom_hours_json TEXT`
    ]
  },
  {
    version: 49,
    description: 'Proyectos en ejecución (active/completed) que quedaron en etapa quoting pasan a approved (creados desde cotización antes de fijar la etapa)',
    up: [
      `UPDATE projects SET commercial_stage = 'approved', client_approved_at = COALESCE(client_approved_at, created_at)
       WHERE commercial_stage = 'quoting' AND status IN ('active', 'completed')`
    ]
  }
];

