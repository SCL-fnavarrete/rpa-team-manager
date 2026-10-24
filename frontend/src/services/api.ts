import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { LoginCredentials, LoginResponse, User } from '@/types/auth';
import { Project } from '@/types/project';
import { ProjectHealth, ProjectBaseline } from '../types/projectHealth';
import { ActivityLogEntry } from '../types/activity';
import { NotificationItem } from '../types/notification';
import { TeamCostsResponse } from '@/types/teamCosts';
import { CostCenter, ProjectCostCenterAllocation, CostCenterBillingSummaryRow } from '@/types/costCenter';
import { PortfolioFilters, PortfolioResult } from '@/types/portfolio';
import { ClosureReport } from '@/types/closureReport';

interface RequestCache {
  [key: string]: {
    promise: Promise<any>;
    timestamp: number;
  };
}

interface RateLimitState {
  [endpoint: string]: {
    count: number;
    resetTime: number;
    retryAfter?: number;
  };
}

class ApiService {
  private api: AxiosInstance;
  private baseURL: string;
  private requestCache: RequestCache = {};
  private rateLimitState: RateLimitState = {};
  private readonly CACHE_TTL = 1000; // 1 second cache for deduplication
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute window
  private readonly MAX_REQUESTS_PER_WINDOW = 50; // Max requests per endpoint per window

  constructor() {
    this.baseURL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5001';
    
    this.api = axios.create({
      baseURL: `${this.baseURL}/api`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000, // Increased to 60 seconds to match batch deletion timeout
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor to add auth token
    this.api.interceptors.request.use(
      (config: any) => {
        const token = localStorage.getItem('rpa_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response: AxiosResponse) => {
        // Track successful responses for rate limiting
        const endpoint = this.getEndpointKey(response.config.url || '', response.config.method || '');
        this.updateRateLimitState(endpoint, false);
        return response;
      },
      (error) => {
        const endpoint = error.config ? this.getEndpointKey(error.config.url || '', error.config.method || '') : '';
        
        // Handle rate limiting (429 errors)
        if (error.response?.status === 429) {
          console.warn('🚦 Rate limit exceeded for:', endpoint);
          const retryAfter = error.response.headers['retry-after'];
          if (endpoint && retryAfter) {
            this.rateLimitState[endpoint] = {
              count: this.MAX_REQUESTS_PER_WINDOW,
              resetTime: Date.now() + (parseInt(retryAfter) * 1000),
              retryAfter: parseInt(retryAfter)
            };
          }
          
          // Create a more user-friendly error
          const rateLimitError = new Error("Hay demasiadas solicitudes. Espera antes de volver a intentarlo.");
          (rateLimitError as any).code = 'RATE_LIMIT_EXCEEDED';
          (rateLimitError as any).retryAfter = retryAfter;
          (rateLimitError as any).originalError = error;
          return Promise.reject(rateLimitError);
        }
        
        // Handle authentication errors
        if (error.response?.status === 401) {
          console.log('🔴 401 Unauthorized - Token expired or invalid, clearing auth data');
          // Clear all auth data from multiple storage locations
          localStorage.removeItem('rpa_token');
          localStorage.removeItem('rpa_user');
          localStorage.removeItem('rpa-auth-storage');
          
          // Clear the auth store by dispatching a logout action
          // This ensures the Zustand store is also cleared
          const authStoreStr = localStorage.getItem('rpa-auth-storage');
          if (authStoreStr) {
            try {
              const authStore = JSON.parse(authStoreStr);
              if (authStore.state) {
                authStore.state.user = null;
                authStore.state.token = null;
                authStore.state.permissions = [];
                authStore.state.isAuthenticated = false;
                localStorage.setItem('rpa-auth-storage', JSON.stringify(authStore));
              }
            } catch (e) {
              console.error('Error clearing auth store:', e);
            }
          }
          
          // Only redirect if not already on login page
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        
        // Enhance error object with better structure
        const enhancedError = this.enhanceError(error);
        return Promise.reject(enhancedError);
      }
    );
  }

  // Enhanced request methods with deduplication and rate limiting
  private getEndpointKey(url: string, method: string): string {
    return `${method.toUpperCase()}:${url}`;
  }

  private getCacheKey(url: string, method: string, data?: any): string {
    const dataString = data ? JSON.stringify(data) : '';
    return `${method.toUpperCase()}:${url}:${dataString}`;
  }

  private updateRateLimitState(endpoint: string, increment: boolean = true): void {
    const now = Date.now();
    
    if (!this.rateLimitState[endpoint]) {
      this.rateLimitState[endpoint] = {
        count: 0,
        resetTime: now + this.RATE_LIMIT_WINDOW
      };
    }

    const state = this.rateLimitState[endpoint];
    
    // Reset if window has passed
    if (now > state.resetTime) {
      state.count = 0;
      state.resetTime = now + this.RATE_LIMIT_WINDOW;
      delete state.retryAfter;
    }

    if (increment) {
      state.count++;
    }
  }

  private isRateLimited(endpoint: string): boolean {
    const state = this.rateLimitState[endpoint];
    if (!state) return false;

    const now = Date.now();
    
    // Check if we're still in retry period
    if (state.retryAfter && now < state.resetTime) {
      return true;
    }

    // Reset if window has passed
    if (now > state.resetTime) {
      state.count = 0;
      state.resetTime = now + this.RATE_LIMIT_WINDOW;
      delete state.retryAfter;
      return false;
    }

    return state.count >= this.MAX_REQUESTS_PER_WINDOW;
  }

  private cleanupCache(): void {
    const now = Date.now();
    Object.keys(this.requestCache).forEach(key => {
      if (now - this.requestCache[key].timestamp > this.CACHE_TTL) {
        delete this.requestCache[key];
      }
    });
  }

  private enhanceError(error: any): Error {
    const enhanced = new Error();
    
    if (error.response?.data?.error) {
      enhanced.message = error.response.data.error;
    } else if (error.message) {
      enhanced.message = error.message;
    } else {
      enhanced.message = "Ocurrió un error inesperado";
    }

    // Add structured properties
    (enhanced as any).code = error.response?.data?.code || error.code || 'UNKNOWN_ERROR';
    (enhanced as any).status = error.response?.status;
    (enhanced as any).timestamp = new Date().toISOString();
    (enhanced as any).originalError = error;

    return enhanced;
  }

  private async makeRequest<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    enableCache: boolean = true
  ): Promise<T> {
    // Clean up old cache entries
    this.cleanupCache();

    const endpoint = this.getEndpointKey(url, method);
    
    // Check rate limiting
    if (this.isRateLimited(endpoint)) {
      const state = this.rateLimitState[endpoint];
      const waitTime = Math.ceil((state.resetTime - Date.now()) / 1000);
      throw new Error(`Demasiadas solicitudes. Espera ${waitTime} segundos antes de volver a intentarlo.`);
    }

    // Check request cache for deduplication (only for GET requests or if explicitly enabled)
    if (enableCache && (method === 'get' || method === 'post')) {
      const cacheKey = this.getCacheKey(url, method, data);
      const cached = this.requestCache[cacheKey];
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(`🎯 Using cached request for: ${endpoint}`);
        return cached.promise;
      }

      // Update rate limit state
      this.updateRateLimitState(endpoint);

      // Create and cache the request
      const promise = this.api[method](url, method === 'get' ? config : data, method === 'get' ? undefined : config)
        .then(response => response.data);

      this.requestCache[cacheKey] = {
        promise,
        timestamp: Date.now()
      };

      // Clean up cache entry after completion
      promise.finally(() => {
        setTimeout(() => {
          delete this.requestCache[cacheKey];
        }, this.CACHE_TTL);
      });

      return promise;
    }

    // Update rate limit state
    this.updateRateLimitState(endpoint);

    // Make the request directly
    const response = await this.api[method](url, method === 'get' ? config : data, method === 'get' ? undefined : config);
    return response.data;
  }

  // Utility methods for fileService
  getBaseURL(): string {
    return this.baseURL;
  }

  getToken(): string | null {
    return localStorage.getItem('rpa_token');
  }

  // Health check
  async healthCheck(): Promise<any> {
    const response = await axios.get(`${this.baseURL}/health`);
    return response.data;
  }

  // Authentication endpoints
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await this.api.post('/auth/login', credentials);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
  }

  async getCurrentUser(): Promise<{ user: User; permissions: string[] }> {
    const response = await this.api.get('/auth/me');
    return response.data;
  }

  async updateProfile(data: { full_name?: string; email?: string }): Promise<{ user: User }> {
    const response = await this.api.put('/auth/me', data);
    return response.data;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.api.post('/auth/change-password', {
      oldPassword,
      newPassword
    });
  }

  async resetPassword(email: string): Promise<{ message: string; tempPassword?: string }> {
    const response = await this.api.post('/auth/reset-password', { email });
    return response.data;
  }

  async getUsers(): Promise<{ id: number; full_name: string; email: string; role: string; is_active?: boolean; created_at?: string }[]> {
    const response = await this.api.get('/auth/users');
    return response.data;
  }

  // Project endpoints
  async getProjects(): Promise<Project[]> {
    const response = await this.api.get('/projects');
    return response.data;
  }

  async getProject(id: number): Promise<Project> {
    const response = await this.api.get(`/projects/${id}`);
    return response.data;
  }

  async createProject(projectData: Partial<Project>): Promise<Project> {
    const response = await this.api.post('/projects', projectData);
    return response.data;
  }

  async updateProject(id: number, updates: Partial<Project>): Promise<Project> {
    const response = await this.api.put(`/projects/${id}`, updates);
    return response.data;
  }

  async deleteProject(id: number): Promise<void> {
    await this.api.delete(`/projects/${id}`);
  }

  // Financial endpoints
  async getROIDashboard(): Promise<any> {
    const response = await this.api.get('/financial/dashboard');
    return response.data;
  }

  async getUserCosts(): Promise<any[]> {
    const response = await this.api.get('/financial/user-costs');
    return response.data;
  }

  async createUserCost(data: { user_id: number; monthly_cost: number; effective_from: string }): Promise<any> {
    const response = await this.api.post('/financial/user-costs', data);
    return response.data;
  }

  async getTeamCosts(): Promise<TeamCostsResponse> {
    const response = await this.api.get('/financial/team-costs');
    return response.data;
  }

  async getProjectROI(projectId: number): Promise<any> {
    const response = await this.api.get(`/financial/project-roi/${projectId}`);
    return response.data;
  }

  async getProjectHealth(projectId: number): Promise<ProjectHealth> {
    const response = await this.api.get(`/projects/${projectId}/health`);
    return response.data;
  }

  async freezeProjectBaseline(projectId: number): Promise<ProjectBaseline> {
    const response = await this.api.post(`/projects/${projectId}/baseline`);
    return response.data;
  }

  async getProjectActivity(projectId: number, params?: { limit?: number; offset?: number }): Promise<ActivityLogEntry[]> {
    const response = await this.api.get(`/projects/${projectId}/activity`, { params });
    return response.data;
  }


  async getProjectLogEntries(projectId: number): Promise<any[]> {
    const response = await this.api.get(`/projects/${projectId}/log-entries`);
    return response.data;
  }

  async createProjectLogEntry(projectId: number, payload: { entry_type: string; description: string; file_id?: number | null }): Promise<any> {
    const response = await this.api.post(`/projects/${projectId}/log-entries`, payload);
    return response.data;
  }

  async getTaskActivity(taskId: number, params?: { limit?: number; offset?: number }): Promise<ActivityLogEntry[]> {
    const response = await this.api.get(`/tasks/${taskId}/activity`, { params });
    return response.data;
  }

  async getNotifications(params?: { limit?: number; offset?: number; unread?: boolean }): Promise<NotificationItem[]> {
    const response = await this.api.get('/notifications', { params });
    return response.data;
  }

  async getUnreadNotificationCount(): Promise<{ count: number }> {
    const response = await this.api.get('/notifications/unread-count');
    return response.data;
  }

  async markNotificationRead(notificationId: number): Promise<void> {
    await this.api.patch(`/notifications/${notificationId}/read`);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.api.patch('/notifications/read-all');
  }

  async getTaskById(taskId: number): Promise<any> {
    const response = await this.api.get(`/tasks/${taskId}`);
    return response.data;
  }

  async searchTasks(search: string): Promise<any[]> {
    const response = await this.api.get('/tasks', { params: { search, limit: 10 } });
    return response.data;
  }

  // Billing endpoints (Fase 2 - Cobros e hitos de pago)
  async getBillingDashboard(projectId?: number): Promise<any> {
    const url = projectId ? `/billing/dashboard?project_id=${projectId}` : '/billing/dashboard';
    const response = await this.api.get(url);
    return response.data;
  }

  async getPaymentMilestones(projectId?: number, options?: { cost_center_id?: number; rpa_only?: boolean }): Promise<any[]> {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId.toString());
    if (options?.cost_center_id) params.append('cost_center_id', options.cost_center_id.toString());
    if (options?.rpa_only) params.append('rpa_only', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.api.get(`/billing/payment-milestones${query}`);
    return response.data;
  }

  async createPaymentMilestone(data: any): Promise<any> {
    const response = await this.api.post('/billing/payment-milestones', data);
    return response.data;
  }

  async updatePaymentMilestone(id: number, data: any): Promise<any> {
    const response = await this.api.put(`/billing/payment-milestones/${id}`, data);
    return response.data;
  }

  async deletePaymentMilestone(id: number): Promise<void> {
    await this.api.delete(`/billing/payment-milestones/${id}`);
  }

  async completePaymentMilestone(id: number, notes?: string): Promise<any> {
    const response = await this.api.post(`/billing/payment-milestones/${id}/complete`, { notes });
    return response.data;
  }

  async getInvoices(projectId?: number): Promise<any[]> {
    const url = projectId ? `/billing/invoices?project_id=${projectId}` : '/billing/invoices';
    const response = await this.api.get(url);
    return response.data;
  }

  async createInvoice(data: any): Promise<any> {
    const response = await this.api.post('/billing/invoices', data);
    return response.data;
  }

  async recordPayment(invoiceId: number, data: any): Promise<any> {
    const response = await this.api.post(`/billing/invoices/${invoiceId}/payments`, data);
    return response.data;
  }

  getPaymentStatementUrl(projectId: number): string {
    return `${this.getBaseURL()}/api/billing/projects/${projectId}/payment-statement`;
  }

  async downloadPaymentStatement(projectId: number): Promise<Blob> {
    const response = await fetch(this.getPaymentStatementUrl(projectId), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${this.getToken()}` },
    });
    if (!response.ok) {
      throw new Error('No se pudo generar el estado de pago');
    }
    return response.blob();
  }

  // Cost Centers endpoints (Fase 6G)
  async getCostCenters(params?: { country?: string; is_rpa?: boolean; active_only?: boolean }): Promise<CostCenter[]> {
    const query = new URLSearchParams();
    if (params?.country) query.append('country', params.country);
    if (params?.is_rpa !== undefined) query.append('is_rpa', params.is_rpa.toString());
    if (params?.active_only !== undefined) query.append('active_only', params.active_only.toString());
    const queryString = query.toString() ? `?${query.toString()}` : '';
    const response = await this.api.get(`/cost-centers${queryString}`);
    const resData = response.data;
    if (Array.isArray(resData)) return resData;
    if (Array.isArray(resData?.data)) return resData.data;
    return [];
  }

  async getCostCenterById(id: number): Promise<CostCenter> {
    const response = await this.api.get(`/cost-centers/${id}`);
    return response.data?.data || response.data;
  }

  async createCostCenter(data: Partial<CostCenter>): Promise<CostCenter> {
    const response = await this.api.post('/cost-centers', data);
    return response.data?.data || response.data;
  }

  async updateCostCenter(id: number, data: Partial<CostCenter>): Promise<CostCenter> {
    const response = await this.api.put(`/cost-centers/${id}`, data);
    return response.data?.data || response.data;
  }

  async getProjectCostCenters(projectId: number): Promise<{
    project_id: number;
    sale_price: number | null;
    currency: string;
    total_allocated: number;
    allocations: ProjectCostCenterAllocation[];
  }> {
    const response = await this.api.get(`/commercial/projects/${projectId}/cost-centers`);
    const resData = response.data?.data || response.data;
    return {
      project_id: resData?.project_id || projectId,
      sale_price: resData?.sale_price ?? null,
      currency: resData?.currency || 'CLP',
      total_allocated: resData?.total_allocated || 0,
      allocations: Array.isArray(resData?.allocations) ? resData.allocations : []
    };
  }

  async setProjectCostCenters(projectId: number, data: { allocations: any[]; quote_id?: number | null }): Promise<any> {
    const response = await this.api.put(`/commercial/projects/${projectId}/cost-centers`, data);
    return response.data?.data || response.data;
  }

  async getCostCenterBillingSummary(params?: { country?: string; is_rpa?: boolean; project_id?: number }): Promise<CostCenterBillingSummaryRow[]> {
    const query = new URLSearchParams();
    if (params?.country) query.append('country', params.country);
    if (params?.is_rpa !== undefined) query.append('is_rpa', params.is_rpa.toString());
    if (params?.project_id) query.append('project_id', params.project_id.toString());
    const queryString = query.toString() ? `?${query.toString()}` : '';
    const response = await this.api.get(`/billing/cost-center-summary${queryString}`);
    const resData = response.data;
    if (Array.isArray(resData)) return resData;
    if (Array.isArray(resData?.data)) return resData.data;
    return [];
  }

  // Capacity & FTE management (Fase 6F)
  async getTeamCapacity(): Promise<{ data: any[]; summary: any }> {
    const response = await this.api.get('/commercial/team-capacity');
    return response.data;
  }

  async getProjectCapacity(projectId: number): Promise<any[]> {
    const response = await this.api.get(`/commercial/projects/${projectId}/capacity`);
    return response.data?.data || response.data || [];
  }

  async saveProjectCapacity(projectId: number, data: any): Promise<any> {
    const response = await this.api.post(`/commercial/projects/${projectId}/capacity`, data);
    return response.data;
  }

  async deleteProjectCapacity(projectId: number, userId: number): Promise<void> {
    await this.api.delete(`/commercial/projects/${projectId}/capacity/${userId}`);
  }

  // Informe de cierre (solo team_lead): el backend responde { data: ClosureReport } y el PDF exige el token
  async getClosureReport(projectId: number): Promise<ClosureReport> {
    const response = await this.api.get(`/commercial/projects/${projectId}/closure-report`);
    return response.data.data;
  }

  async downloadClosureReportPdf(projectId: number): Promise<Blob> {
    const response = await this.api.get(`/commercial/projects/${projectId}/closure-report.pdf`, { responseType: 'blob' });
    return response.data;
  }

  // Timesheet endpoints (Fase 3 - Tiempo confiable y efectividad)
  async getTimesheetWeek(weekStart: string): Promise<any> {
    const response = await this.api.get(`/timesheet/week?week_start=${weekStart}`);
    return response.data;
  }

  async saveTimesheetWeek(weekStart: string, entries: any[]): Promise<any> {
    const response = await this.api.put('/timesheet/week', { week_start: weekStart, entries });
    return response.data;
  }

  async submitTimesheetWeek(weekStart: string): Promise<any> {
    const response = await this.api.post('/timesheet/week/submit', { week_start: weekStart });
    return response.data;
  }

  async getTimesheetReminders(): Promise<any> {
    const response = await this.api.get('/timesheet/reminders');
    return response.data;
  }

  async getPendingTimesheetApprovals(): Promise<any[]> {
    const response = await this.api.get('/timesheet/pending-approvals');
    return response.data;
  }

  async approveTimesheetWeek(periodId: number): Promise<any> {
    const response = await this.api.post(`/timesheet/periods/${periodId}/approve`);
    return response.data;
  }

  async rejectTimesheetWeek(periodId: number, reason: string): Promise<any> {
    const response = await this.api.post(`/timesheet/periods/${periodId}/reject`, { reason });
    return response.data;
  }

  async getEffectivenessMetrics(from: string, to: string): Promise<any> {
    const response = await this.api.get(`/timesheet/effectiveness?from=${from}&to=${to}`);
    return response.data;
  }

  // Task Management APIs
  async getTaskBoards(projectId?: number): Promise<any> {
    const url = projectId ? `/tasks/boards?project_id=${projectId}` : '/tasks/boards';
    const response = await this.api.get(url);
    return response.data;
  }

  async getTaskBoard(boardId: number): Promise<any> {
    const response = await this.api.get(`/tasks/boards/${boardId}`);
    return response.data;
  }

  async createTaskBoard(boardData: any): Promise<any> {
    const response = await this.api.post('/tasks/boards', boardData);
    return response.data;
  }

  async getTasks(filters?: any): Promise<any> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const response = await this.api.get(`/tasks?${params.toString()}`);
    return response.data;
  }

  async createTask(taskData: any): Promise<any> {
    const response = await this.api.post('/tasks', taskData);
    return response.data;
  }

  async updateTask(taskId: number, taskData: any): Promise<any> {
    const response = await this.api.put(`/tasks/${taskId}`, taskData);
    return response.data;
  }

  async deleteTask(taskId: number): Promise<any> {
    const response = await this.api.delete(`/tasks/${taskId}`);
    return response.data;
  }

  async batchCreateTasks(tasks: any[], boardId: number): Promise<any> {
    console.log(`🚀 API Service: batchCreateTasks called with ${tasks.length} tasks for board ${boardId}`);
    const response = await this.api.post('/tasks/batch', {
      tasks,
      board_id: boardId
    });
    console.log(`✅ API Service: batchCreateTasks response:`, response.data);
    return response.data;
  }

  async batchDeleteTasks(taskIds: number[]): Promise<any> {
    console.log(`🚀 API Service: batchDeleteTasks called with:`, taskIds);
    const response = await this.api.delete('/tasks/batch', {
      data: { taskIds }
    });
    console.log(`✅ API Service: batchDeleteTasks response:`, response.data);
    return response.data;
  }

  async batchUpdateTasks(taskIds: number[], updates: { priority?: string; assignee_id?: number | null; column_id?: number }): Promise<any> {
    const response = await this.api.patch('/tasks/batch', { taskIds, updates });
    return response.data;
  }

  async moveTask(taskId: number, moveData: { column_id: number; position: number }): Promise<any> {
    const response = await this.api.post(`/tasks/${taskId}/move`, moveData);
    return response.data;
  }

  async getMyTasks(): Promise<any> {
    const response = await this.api.get('/tasks/my-tasks');
    return response.data;
  }

  async getTaskSubtasks(taskId: number): Promise<any[]> {
    const response = await this.api.get(`/tasks/${taskId}/subtasks`);
    return response.data;
  }

  async createTaskSubtask(taskId: number, title: string): Promise<any> {
    const response = await this.api.post(`/tasks/${taskId}/subtasks`, { title });
    return response.data;
  }

  async updateTaskSubtask(taskId: number, subtaskId: number, data: { title?: string; is_done?: boolean }): Promise<any> {
    const response = await this.api.patch(`/tasks/${taskId}/subtasks/${subtaskId}`, data);
    return response.data;
  }

  async deleteTaskSubtask(taskId: number, subtaskId: number): Promise<any> {
    const response = await this.api.delete(`/tasks/${taskId}/subtasks/${subtaskId}`);
    return response.data;
  }

  async getComments(entityType: 'task' | 'project', entityId: number): Promise<any[]> {
    const response = await this.api.get(`/${entityType}s/${entityId}/comments`);
    return response.data;
  }

  async createComment(entityType: 'task' | 'project', entityId: number, content: string): Promise<any> {
    const response = await this.api.post(`/${entityType}s/${entityId}/comments`, { content });
    return response.data;
  }

  async updateComment(entityType: 'task' | 'project', entityId: number, commentId: number, content: string): Promise<any> {
    const response = await this.api.patch(`/${entityType}s/${entityId}/comments/${commentId}`, { content });
    return response.data;
  }

  async deleteComment(entityType: 'task' | 'project', entityId: number, commentId: number): Promise<any> {
    const response = await this.api.delete(`/${entityType}s/${entityId}/comments/${commentId}`);
    return response.data;
  }

  async getMentionableUsers(entityType: 'task' | 'project', entityId: number): Promise<any[]> {
    const response = await this.api.get(`/${entityType}s/${entityId}/mentionable-users`);
    return response.data;
  }

  async getTaskTags(taskId: number): Promise<any[]> {
    const response = await this.api.get(`/tasks/${taskId}/tags`);
    return response.data;
  }

  async createTaskTag(taskId: number, tag: string): Promise<any> {
    const response = await this.api.post(`/tasks/${taskId}/tags`, { tag });
    return response.data;
  }

  async deleteTaskTag(taskId: number, tagId: number): Promise<any> {
    const response = await this.api.delete(`/tasks/${taskId}/tags/${tagId}`);
    return response.data;
  }

  async getTaskCollaborators(taskId: number): Promise<any[]> {
    const response = await this.api.get(`/tasks/${taskId}/collaborators`);
    return response.data;
  }

  async addTaskCollaborator(taskId: number, userId: number): Promise<any> {
    const response = await this.api.post(`/tasks/${taskId}/collaborators`, { user_id: userId });
    return response.data;
  }

  async removeTaskCollaborator(taskId: number, collaboratorId: number): Promise<any> {
    const response = await this.api.delete(`/tasks/${taskId}/collaborators/${collaboratorId}`);
    return response.data;
  }

  async getTaskDependencies(taskId: number): Promise<{ depends_on: any[]; blocks: any[] }> {
    const response = await this.api.get(`/tasks/${taskId}/dependencies`);
    return response.data;
  }

  async createTaskDependency(taskId: number, data: { depends_on_task_id: number; dependency_type?: string; lag_days?: number }): Promise<any> {
    const response = await this.api.post(`/tasks/${taskId}/dependencies`, data);
    return response.data;
  }

  async deleteTaskDependency(taskId: number, dependencyId: number): Promise<any> {
    const response = await this.api.delete(`/tasks/${taskId}/dependencies/${dependencyId}`);
    return response.data;
  }

  async getProjectGantt(id: number): Promise<{ tasks: any[]; dependencies: any[]; milestones: any[] }> {
    const response = await this.api.get(`/pmo/projects/${id}/gantt`);
    return response.data;
  }

  // Generic HTTP methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.api.get(url, config);
    return response.data;
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.api.post(url, data, config);
    return response.data;
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.api.put(url, data, config);
    return response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.api.delete(url, config);
    return response.data;
  }

  // Generic request method for custom endpoints
  async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.api.request(config);
    return response.data;
  }

  // Utility methods
  setAuthToken(token: string): void {
    localStorage.setItem('rpa_token', token);
  }

  removeAuthToken(): void {
    localStorage.removeItem('rpa_token');
    localStorage.removeItem('rpa_user');
  }

  getAuthToken(): string | null {
    return localStorage.getItem('rpa_token');
  }

  // Settings endpoints
  async getGlobalSettings(): Promise<any> {
    const response = await this.api.get('/settings');
    return response.data;
  }

  async updateGlobalSettings(settings: any): Promise<any> {
    const response = await this.api.put('/settings', settings);
    return response.data;
  }

  // Tasks API methods
  async getProjectTasks(projectId: number, limit: number = 5): Promise<any[]> {
    const response = await this.api.get(`/tasks/project/${projectId}?limit=${limit}`);
    return response.data;
  }

  // Ideas API methods
  async getIdeas(filters?: any): Promise<any[]> {
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters?.category && filters.category !== 'all') params.append('category', filters.category);
    if (filters?.sort) params.append('sort', filters.sort);
    
    const response = await this.api.get(`/ideas${params.toString() ? '?' + params.toString() : ''}`);
    return response.data;
  }

  async getIdea(id: number): Promise<any> {
    const response = await this.api.get(`/ideas/${id}`);
    return response.data;
  }

  async createIdea(ideaData: any): Promise<any> {
    const response = await this.api.post('/ideas', ideaData);
    return response.data;
  }

  async updateIdea(id: number, updates: any): Promise<any> {
    const response = await this.api.put(`/ideas/${id}`, updates);
    return response.data;
  }

  async deleteIdea(id: number): Promise<void> {
    await this.api.delete(`/ideas/${id}`);
  }

  async voteIdea(id: number, voteType: 'up' | 'down'): Promise<any> {
    const response = await this.api.post(`/ideas/${id}/vote`, { vote_type: voteType });
    return response.data;
  }

  async getIdeaComments(id: number): Promise<any[]> {
    const response = await this.api.get(`/ideas/${id}/comments`);
    return response.data;
  }

  async createIdeaComment(id: number, comment: string): Promise<any> {
    const response = await this.api.post(`/ideas/${id}/comments`, { comment });
    return response.data;
  }

  async getIdeaStats(): Promise<any> {
    const response = await this.api.get('/ideas/stats');
    return response.data;
  }

  // Support API methods
  // Support Companies
  async getSupportCompanies(filters?: any): Promise<any> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.month) params.append('month', filters.month);
    
    const response = await this.api.get(`/support/companies${params.toString() ? '?' + params.toString() : ''}`);
    return response.data;
  }

  async getSupportCompany(id: number): Promise<any> {
    const response = await this.api.get(`/support/companies/${id}`);
    return response.data;
  }

  async createSupportCompany(companyData: any): Promise<any> {
    const response = await this.api.post('/support/companies', companyData);
    return response.data;
  }

  async updateSupportCompany(id: number, updates: any): Promise<any> {
    const response = await this.api.put(`/support/companies/${id}`, updates);
    return response.data;
  }

  async deleteSupportCompany(id: number): Promise<{ message: string; deletedTickets: number }> {
    const response = await this.api.delete(`/support/companies/${id}`);
    return response.data;
  }

  async getSupportCompanyMetrics(id: number, months?: number): Promise<any> {
    const params = months ? `?months=${months}` : '';
    const response = await this.api.get(`/support/companies/${id}/metrics${params}`);
    return response.data;
  }

  // Support Tickets
  async getSupportTickets(filters?: any): Promise<any> {
    const params = new URLSearchParams();
    if (filters?.company_id) params.append('company_id', filters.company_id.toString());
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.ticket_type) params.append('ticket_type', filters.ticket_type);
    if (filters?.resolver_id) params.append('resolver_id', filters.resolver_id.toString());
    if (filters?.search) params.append('search', filters.search);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());
    
    const response = await this.api.get(`/support/tickets${params.toString() ? '?' + params.toString() : ''}`);
    return response.data;
  }

  async getSupportTicket(id: string): Promise<any> {
    const response = await this.api.get(`/support/tickets/${id}`);
    return response.data;
  }

  async createSupportTicket(ticketData: any): Promise<any> {
    const response = await this.api.post('/support/tickets', ticketData);
    return response.data;
  }

  async updateSupportTicket(id: string, updates: any): Promise<any> {
    const response = await this.api.put(`/support/tickets/${id}`, updates);
    return response.data;
  }

  async addSupportTicketComment(id: string, commentData: any): Promise<any> {
    const response = await this.api.post(`/support/tickets/${id}/comments`, commentData);
    return response.data;
  }

  // Support Dashboard & Reports
  async getSupportDashboard(month?: string): Promise<any> {
    const params = month ? { month } : {};
    const response = await this.api.get('/support/dashboard', { params });
    return response.data;
  }

  async getSupportBillingReport(year?: number, month?: number): Promise<any> {
    const params = new URLSearchParams();
    if (year) params.append('year', year.toString());
    if (month) params.append('month', month.toString());
    
    const response = await this.api.get(`/support/billing-report${params.toString() ? '?' + params.toString() : ''}`);
    return response.data;
  }

  // Support RPA Processes
  async getRPAProcesses(companyId?: number): Promise<any> {
    const url = companyId ? `/support/rpa-processes?company_id=${companyId}` : '/support/rpa-processes';
    const response = await this.api.get(url);
    return response.data;
  }

  async createRPAProcess(processData: { company_id: number; process_name: string; process_description?: string }): Promise<any> {
    const response = await this.api.post('/support/rpa-processes', processData);
    return response.data;
  }

  // Support Contacts
  async getAllContacts(): Promise<any> {
    const response = await this.api.get('/support/contacts');
    return response.data;
  }

  async getCompanyContacts(companyId: number): Promise<any> {
    const response = await this.api.get(`/support/companies/${companyId}/contacts`);
    return response.data;
  }

  async createCompanyContact(companyId: number, contactData: any): Promise<any> {
    const response = await this.api.post(`/support/companies/${companyId}/contacts`, contactData);
    return response.data;
  }

  // PMO API methods
  async getPMODashboard(): Promise<any> {
    const response = await this.api.get('/pmo/dashboard');
    return response.data;
  }

  async getPMOExecutiveSuite(): Promise<any> {
    const response = await this.api.get('/pmo/executive-suite');
    return response.data;
  }

  async getPMOAnalytics(): Promise<any> {
    return this.makeRequest<any>('get', '/pmo/analytics', undefined, undefined, true);
  }

  async getPMOProjectGantt(projectId: number): Promise<any> {
    return this.makeRequest<any>('get', `/pmo/projects/${projectId}/gantt`, undefined, undefined, true);
  }

  // Cartera de proyectos (solo team_lead): el backend responde { data: PortfolioResult }
  async getPortfolio(filters?: PortfolioFilters): Promise<PortfolioResult> {
    const response = await this.api.get('/portfolio', { params: filters });
    return response.data.data;
  }

  async createMilestone(milestoneData: any): Promise<any> {
    const response = await this.api.post('/pmo/milestones', milestoneData);
    return response.data;
  }

  async updateMilestone(milestoneId: number, updates: any): Promise<any> {
    const response = await this.api.put(`/pmo/milestones/${milestoneId}`, updates);
    return response.data;
  }

  async deleteMilestone(milestoneId: number): Promise<any> {
    const response = await this.api.delete(`/pmo/milestones/${milestoneId}`);
    return response.data;
  }

  async batchCreateMilestones(milestones: any[], projectId: number): Promise<any> {
    console.log(`🚀 API Service: batchCreateMilestones called with ${milestones.length} milestones for project ${projectId}`);
    const response = await this.api.post('/pmo/milestones/batch', {
      milestones,
      project_id: projectId
    });
    console.log(`✅ API Service: batchCreateMilestones response:`, response.data);
    return response.data;
  }

  async batchDeleteMilestones(milestoneIds: number[]): Promise<any> {
    const response = await this.api.delete('/pmo/milestones/batch', {
      data: { milestoneIds }
    });
    return response.data;
  }

  async getProjectPMOMetrics(projectId: number): Promise<any> {
    const response = await this.api.get(`/pmo/projects/${projectId}/metrics`);
    return response.data;
  }

  async updateProjectMetrics(projectId: number, metrics: any): Promise<any> {
    const response = await this.api.post(`/pmo/projects/${projectId}/metrics`, metrics);
    return response.data;
  }

  // Admin/User Management API methods
  async createUser(userData: { full_name: string; email: string; role: string; password: string }): Promise<any> {
    const response = await this.api.post('/auth/admin/users', userData);
    return response.data;
  }

  async updateUser(userId: number, updates: { full_name?: string; email?: string; role?: string; is_active?: boolean }): Promise<any> {
    const response = await this.api.put(`/auth/admin/users/${userId}`, updates);
    return response.data;
  }

  async deleteUser(userId: number): Promise<any> {
    const response = await this.api.delete(`/auth/admin/users/${userId}`);
    return response.data;
  }

  async resetUserPassword(userId: number, newPassword: string): Promise<any> {
    const response = await this.api.post(`/auth/admin/users/${userId}/reset-password`, { newPassword });
    return response.data;
  }

  // Excel Import API methods
  async previewExcelImport(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await this.api.post('/support/import/preview', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async executeExcelImport(file: File, mappings: any, options: any = {}): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mappings', JSON.stringify(mappings));
    formData.append('options', JSON.stringify(options));

    const response = await this.api.post('/support/import/execute', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  // ========================================
  // PROJECT LIFECYCLE API METHODS
  // ========================================

  // Phase Templates
  async getPhaseTemplates(): Promise<any> {
    const response = await this.api.get('/lifecycle/templates');
    return response.data;
  }

  // Project Phases
  async getProjectPhases(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/phases`);
    return response.data;
  }

  async createProjectPhase(projectId: number, phaseData: any): Promise<any> {
    const response = await this.api.post(`/lifecycle/projects/${projectId}/phases`, phaseData);
    return response.data;
  }

  async updateProjectPhase(phaseId: number, updates: any): Promise<any> {
    const response = await this.api.put(`/lifecycle/phases/${phaseId}`, updates);
    return response.data;
  }

  async deleteProjectPhase(phaseId: number): Promise<any> {
    const response = await this.api.delete(`/lifecycle/phases/${phaseId}`);
    return response.data;
  }

  async initializeProjectPhases(projectId: number, templateIds?: number[]): Promise<any> {
    const response = await this.api.post(`/lifecycle/projects/${projectId}/phases/initialize`, {
      template_ids: templateIds
    });
    return response.data;
  }

  // Phase Activities
  async getPhaseActivities(phaseId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/phases/${phaseId}/activities`);
    return response.data;
  }

  async createPhaseActivity(phaseId: number, activityData: any): Promise<any> {
    const response = await this.api.post(`/lifecycle/phases/${phaseId}/activities`, activityData);
    return response.data;
  }

  async updatePhaseActivity(activityId: number, updates: any): Promise<any> {
    const response = await this.api.put(`/lifecycle/activities/${activityId}`, updates);
    return response.data;
  }

  async deletePhaseActivity(activityId: number): Promise<any> {
    const response = await this.api.delete(`/lifecycle/activities/${activityId}`);
    return response.data;
  }

  // Project Delays
  async getProjectDelays(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/delays`);
    return response.data;
  }

  async createProjectDelay(delayData: any): Promise<any> {
    const response = await this.api.post('/lifecycle/delays', delayData);
    return response.data;
  }

  async updateProjectDelay(delayId: number, updates: any): Promise<any> {
    const response = await this.api.put(`/lifecycle/delays/${delayId}`, updates);
    return response.data;
  }

  async resolveProjectDelay(delayId: number, resolution: string, delayEndDate: string): Promise<any> {
    const response = await this.api.post(`/lifecycle/delays/${delayId}/resolve`, {
      resolution,
      delay_end_date: delayEndDate
    });
    return response.data;
  }

  // Scope Changes
  async getProjectScopeChanges(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/scope-changes`);
    return response.data;
  }

  async createScopeChange(scopeChangeData: any): Promise<any> {
    const response = await this.api.post('/lifecycle/scope-changes', scopeChangeData);
    return response.data;
  }

  async updateScopeChange(changeId: number, updates: any): Promise<any> {
    const response = await this.api.put(`/lifecycle/scope-changes/${changeId}`, updates);
    return response.data;
  }

  async approveScopeChange(changeId: number): Promise<any> {
    const response = await this.api.post(`/lifecycle/scope-changes/${changeId}/approve`);
    return response.data;
  }

  async rejectScopeChange(changeId: number, reason: string): Promise<any> {
    const response = await this.api.post(`/lifecycle/scope-changes/${changeId}/reject`, { reason });
    return response.data;
  }

  // ROI Analysis
  async getProjectROIAnalysis(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/roi-analysis`);
    return response.data;
  }

  async getProjectLifecycleMetrics(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/metrics`);
    return response.data;
  }

  // Batch Operations
  async getProjectLifecycleSummary(projectId: number): Promise<any> {
    const response = await this.api.get(`/lifecycle/projects/${projectId}/summary`);
    return response.data;
  }

  // RPA Project Reviewer Skill
  async reviewProjectWithSkill(projectId: number, provider?: string): Promise<any> {
    const response = await this.api.post(`/ai/projects/${projectId}/review`, { provider });
    return response.data;
  }

  async getSkillConfig(): Promise<any> {
    const response = await this.api.get('/ai/skills/project-reviewer');
    return response.data;
  }

  async updateSkillConfig(config: any): Promise<any> {
    const response = await this.api.put('/ai/skills/project-reviewer', config);
    return response.data;
  }

  async resetSkillConfig(): Promise<any> {
    const response = await this.api.post('/ai/skills/project-reviewer/reset');
    return response.data;
  }
}

// Export singleton instance
export const apiService = new ApiService();
export default apiService;
