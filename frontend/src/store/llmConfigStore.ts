import { create } from 'zustand';
import { apiService } from '@/services/api';

export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'deepseek';

export interface LLMApiKey {
  id: number;
  user_id: number;
  provider: LLMProvider;
  api_key_masked: string;
  selected_model: string | null;
  reasoning_effort: string | null;
  is_valid: boolean;
  last_validated: string | null;
  validation_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelOption {
  value: string;
  label: string;
  reasoning_options?: string[];
}

export interface AvailableModels {
  openai: ModelOption[];
  claude: ModelOption[];
  gemini: ModelOption[];
  deepseek: ModelOption[];
}

export const DEFAULT_AVAILABLE_MODELS: AvailableModels = {
  openai: [
    { value: 'gpt-6-luna', label: 'GPT-6 Luna', reasoning_options: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'gpt-5.4', label: 'GPT-5.4', reasoning_options: ['none', 'low', 'medium', 'high', 'xhigh'] },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gpt-5.2', label: 'GPT-5.2', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gpt-5', label: 'GPT-5', reasoning_options: ['minimal', 'low', 'medium', 'high'] },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini', reasoning_options: ['minimal', 'low', 'medium', 'high'] },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano', reasoning_options: ['minimal', 'low', 'medium', 'high'] },
    { value: 'o3', label: 'OpenAI o3 (Razonamiento)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'o3-pro', label: 'OpenAI o3-pro (Razonamiento)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'o4-mini', label: 'OpenAI o4-mini (Razonamiento)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'o3-mini', label: 'OpenAI o3-mini (Razonamiento)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'o1', label: 'OpenAI o1 (Razonamiento)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
  ],
  claude: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', reasoning_options: ['none', 'low', 'medium', 'high', 'max'] },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', reasoning_options: ['none', 'low', 'medium', 'high', 'max'] },
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-4-opus-20250514', label: 'Claude 4 Opus', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-4-sonnet-20250514', label: 'Claude 4 Sonnet', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-4-haiku-20250514', label: 'Claude 4 Haiku' },
    { value: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet (Extended Thinking)', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' }
  ],
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gemini-2.5-pro-latest', label: 'Gemini 2.5 Pro (Latest)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'gemini-2.5-flash-latest', label: 'Gemini 2.5 Flash (Latest)', reasoning_options: ['none', 'low', 'medium', 'high'] },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
    { value: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash' },
    { value: 'gemma-3-27b-it', label: 'Gemma 3 27B Instruct' }
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek V3.2 Chat (deepseek-chat)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek R1 Reasoner (deepseek-reasoner)', reasoning_options: ['low', 'medium', 'high'] },
    { value: 'deepseek-chat-v3', label: 'DeepSeek V3' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder' }
  ]
};

export interface ValidationResult {
  is_valid: boolean;
  error?: string;
  provider_info?: any;
}

interface LLMConfigState {
  apiKeys: LLMApiKey[];
  availableModels: AvailableModels;
  isLoading: boolean;
  error: string | null;
  validating: Record<LLMProvider, boolean>;
}

interface LLMConfigActions {
  fetchApiKeys: () => Promise<void>;
  fetchAvailableModels: () => Promise<void>;
  validateApiKey: (provider: LLMProvider, apiKey: string) => Promise<ValidationResult>;
  saveApiKey: (provider: LLMProvider, apiKey: string, selectedModel?: string, reasoningEffort?: string | null) => Promise<void>;
  updateApiKey: (provider: LLMProvider, apiKey: string, selectedModel?: string, reasoningEffort?: string | null) => Promise<void>;
  deleteApiKey: (provider: LLMProvider) => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
}

type LLMConfigStore = LLMConfigState & LLMConfigActions;

export const useLLMConfigStore = create<LLMConfigStore>((set, get) => ({
  // Initial state with complete fallback catalog
  apiKeys: [],
  availableModels: DEFAULT_AVAILABLE_MODELS,
  isLoading: false,
  error: null,
  validating: {
    openai: false,
    claude: false,
    gemini: false,
    deepseek: false
  },

  // Actions
  fetchApiKeys: async () => {
    try {
      set({ isLoading: true, error: null });
      const keys = await apiService.get('/llm-config');
      set({ apiKeys: Array.isArray(keys) ? keys : [], isLoading: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || "No se pudieron cargar las claves API";
      set({ error: errorMessage, isLoading: false, apiKeys: [] });
      throw error;
    }
  },

  fetchAvailableModels: async () => {
    try {
      const models = await apiService.get<AvailableModels>('/llm-config/models');
      if (models && typeof models === 'object') {
        set({
          availableModels: {
            openai: models.openai?.length ? models.openai : DEFAULT_AVAILABLE_MODELS.openai,
            claude: models.claude?.length ? models.claude : DEFAULT_AVAILABLE_MODELS.claude,
            gemini: models.gemini?.length ? models.gemini : DEFAULT_AVAILABLE_MODELS.gemini,
            deepseek: models.deepseek?.length ? models.deepseek : DEFAULT_AVAILABLE_MODELS.deepseek
          }
        });
      }
    } catch (error: any) {
      // Keep DEFAULT_AVAILABLE_MODELS so dropdowns are never empty
      set({ availableModels: DEFAULT_AVAILABLE_MODELS });
    }
  },

  validateApiKey: async (provider: LLMProvider, apiKey: string): Promise<ValidationResult> => {
    try {
      set(state => ({
        validating: { ...state.validating, [provider]: true },
        error: null
      }));

      const result = await apiService.post('/llm-config/validate', {
        provider,
        api_key: apiKey
      });

      set(state => ({
        validating: { ...state.validating, [provider]: false }
      }));

      return result;
    } catch (error: any) {
      set(state => ({
        validating: { ...state.validating, [provider]: false },
        error: error.response?.data?.error || "No se pudo validar"
      }));
      throw error;
    }
  },

  saveApiKey: async (provider: LLMProvider, apiKey: string, selectedModel?: string, reasoningEffort?: string | null) => {
    try {
      set({ isLoading: true, error: null });

      await apiService.post('/llm-config', {
        provider,
        api_key: apiKey || undefined,
        selected_model: selectedModel,
        reasoning_effort: reasoningEffort
      });

      // Refresh the list
      await get().fetchApiKeys();

      set({ isLoading: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || "No se pudo guardar la clave API";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  updateApiKey: async (provider: LLMProvider, apiKey: string, selectedModel?: string, reasoningEffort?: string | null) => {
    try {
      set({ isLoading: true, error: null });

      await apiService.put(`/llm-config/${provider}`, {
        api_key: apiKey || undefined,
        selected_model: selectedModel,
        reasoning_effort: reasoningEffort
      });

      // Refresh the list
      await get().fetchApiKeys();

      set({ isLoading: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || "No se pudo actualizar la clave API";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  deleteApiKey: async (provider: LLMProvider) => {
    try {
      set({ isLoading: true, error: null });

      await apiService.delete(`/llm-config/${provider}`);

      // Refresh the list
      await get().fetchApiKeys();

      set({ isLoading: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || "No se pudo eliminar la clave API";
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  setError: (error: string | null) => set({ error }),
  clearError: () => set({ error: null })
}));
