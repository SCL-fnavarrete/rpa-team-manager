import { apiService } from './api';
import { 
  ScopingInputs, 
  ScopingCalculationResult, 
  ScopingQuotationRecord, 
  RPAArchetype, 
  ScopingKpis 
} from '../types/scoping';

export interface ScopingListResponse {
  success: boolean;
  data: ScopingQuotationRecord[];
  kpis: ScopingKpis;
}

export interface ScopingDetailResponse {
  success: boolean;
  data: ScopingQuotationRecord;
}

export interface ArchetypesResponse {
  success: boolean;
  data: RPAArchetype[];
}

export interface CalculateResponse {
  success: boolean;
  data: ScopingCalculationResult;
}

export const scopingService = {
  /**
   * Obtiene la lista de arquetipos preconfigurados de RPA
   */
  async getArchetypes(): Promise<RPAArchetype[]> {
    const res = await apiService.get<ArchetypesResponse>('/scopings/archetypes');
    return res.data || [];
  },

  /**
   * Ejecuta el cálculo reactivo en memoria para preview durante la reunión
   */
  async calculate(inputs: ScopingInputs): Promise<ScopingCalculationResult> {
    const res = await apiService.post<CalculateResponse>('/scopings/calculate', inputs);
    return res.data;
  },

  /**
   * Obtiene todos los levantamientos guardados con filtros y KPIs
   */
  async getAll(params?: { client?: string; status?: string; archetype?: string; search?: string }): Promise<ScopingListResponse> {
    const query = new URLSearchParams();
    if (params?.client) query.append('client', params.client);
    if (params?.status) query.append('status', params.status);
    if (params?.archetype) query.append('archetype', params.archetype);
    if (params?.search) query.append('search', params.search);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return await apiService.get<ScopingListResponse>(`/scopings${queryString}`);
  },

  /**
   * Obtiene el detalle completo de un levantamiento
   */
  async getById(id: number): Promise<ScopingQuotationRecord> {
    const res = await apiService.get<ScopingDetailResponse>(`/scopings/${id}`);
    return res.data;
  },

  /**
   * Guarda un nuevo levantamiento
   */
  async create(data: Partial<ScopingInputs>): Promise<ScopingQuotationRecord> {
    const res = await apiService.post<{ success: boolean; data: ScopingQuotationRecord }>('/scopings', data);
    return res.data;
  },

  /**
   * Actualiza un levantamiento existente
   */
  async update(id: number, data: Partial<ScopingInputs>): Promise<ScopingQuotationRecord> {
    const res = await apiService.put<{ success: boolean; data: ScopingQuotationRecord }>(`/scopings/${id}`, data);
    return res.data;
  },

  /**
   * Elimina un levantamiento
   */
  async delete(id: number): Promise<boolean> {
    const res = await apiService.delete<{ success: boolean }>(`/scopings/${id}`);
    return res.success;
  },

  /**
   * Convierte la cotización aceptada a un proyecto formal con tareas y fases
   */
  async convertToProject(id: number): Promise<{ project_id: number; message: string }> {
    const res = await apiService.post<{ success: boolean; message: string; data: { project_id: number } }>(
      `/scopings/${id}/convert-to-project`
    );
    return {
      project_id: res.data.project_id,
      message: res.message
    };
  }
};
