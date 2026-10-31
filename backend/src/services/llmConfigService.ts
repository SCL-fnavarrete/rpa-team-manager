import crypto from 'crypto';
import axios from 'axios';
import { trackedLLMPost } from './llmUsageService';
import { db } from '../database/database';
import { logger } from '../utils/logger';

interface LLMApiKey {
    id: number;
    user_id: number;
    provider: string;
    api_key_masked: string;
    selected_model: string | null;
    reasoning_effort: string | null;
    is_valid: boolean;
    last_validated: string | null;
    validation_error: string | null;
    created_at: string;
    updated_at: string;
}

// Available models by provider
export const AVAILABLE_MODELS = {
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

interface ValidationResult {
    is_valid: boolean;
    error?: string;
    provider_info?: any;
}

export class LLMConfigService {
    private encryptionKey: string;
    private algorithm: string = 'aes-256-cbc';

    constructor() {
        // Use environment variable or generate a key
        this.encryptionKey = process.env.ENCRYPTION_KEY ||
            crypto.randomBytes(32).toString('hex');

        if (!process.env.ENCRYPTION_KEY) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('ENCRYPTION_KEY must be set in production');
            }
            logger.warn('ENCRYPTION_KEY not set. Using random key (will not persist across restarts)');
        }
    }

    // Encrypt API key
    private encrypt(text: string): string {
        const key = Buffer.from(this.encryptionKey.substring(0, 32), 'utf-8');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // Return IV + encrypted data
        return iv.toString('hex') + ':' + encrypted;
    }

    // Decrypt API key
    private decrypt(encryptedText: string): string {
        const key = Buffer.from(this.encryptionKey.substring(0, 32), 'utf-8');
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];

        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    // Mask API key for display (show first 7 chars and last 4 chars)
    private maskApiKey(apiKey: string): string {
        if (apiKey.length <= 11) return '***';
        const start = apiKey.substring(0, 7);
        const end = apiKey.substring(apiKey.length - 4);
        return `${start}...${end}`;
    }

    // Validate OpenAI API key
    private async validateOpenAI(apiKey: string): Promise<ValidationResult> {
        try {
            const response = await axios.get('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 10000
            });

            const data = response.data as any;

            return {
                is_valid: true,
                provider_info: {
                    models_count: data.data?.length || 0
                }
            };
        } catch (error: any) {
            return {
                is_valid: false,
                error: error.response?.data?.error?.message || 'Invalid OpenAI API key'
            };
        }
    }

    // Validate Claude (Anthropic) API key
    private async validateClaude(apiKey: string, userId?: number): Promise<ValidationResult> {
        try {
            const body = {
                model: 'claude-3-haiku-20240307',
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Hi' }]
            };
            const config = {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                timeout: 10000
            };
            const response = userId
                ? await trackedLLMPost(userId, 'claude', 'claude-3-haiku-20240307', 'key_validation', 'https://api.anthropic.com/v1/messages', body, config)
                : await axios.post('https://api.anthropic.com/v1/messages', body, config);

            const data = response.data as any;

            return {
                is_valid: true,
                provider_info: {
                    model: data.model
                }
            };
        } catch (error: any) {
            return {
                is_valid: false,
                error: error.response?.data?.error?.message || 'Invalid Claude API key'
            };
        }
    }

    // Validate Google Gemini API key
    private async validateGemini(apiKey: string): Promise<ValidationResult> {
        try {
            const response = await axios.get(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                { timeout: 10000 }
            );

            const data = response.data as any;

            return {
                is_valid: true,
                provider_info: {
                    models_count: data.models?.length || 0
                }
            };
        } catch (error: any) {
            return {
                is_valid: false,
                error: error.response?.data?.error?.message || 'Invalid Gemini API key'
            };
        }
    }

    // Validate DeepSeek API key
    private async validateDeepSeek(apiKey: string, userId?: number): Promise<ValidationResult> {
        try {
            const body = {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10
            };
            const config = {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            };
            const response = userId
                ? await trackedLLMPost(userId, 'deepseek', 'deepseek-chat', 'key_validation', 'https://api.deepseek.com/v1/chat/completions', body, config)
                : await axios.post('https://api.deepseek.com/v1/chat/completions', body, config);

            const data = response.data as any;

            return {
                is_valid: true,
                provider_info: {
                    model: data.model
                }
            };
        } catch (error: any) {
            return {
                is_valid: false,
                error: error.response?.data?.error?.message || 'Invalid DeepSeek API key'
            };
        }
    }

    // Main validation method
    async validateApiKey(provider: string, apiKey: string, userId?: number): Promise<ValidationResult> {
        switch (provider) {
            case 'openai':
                return this.validateOpenAI(apiKey);
            case 'claude':
                return this.validateClaude(apiKey, userId);
            case 'gemini':
                return this.validateGemini(apiKey);
            case 'deepseek':
                return this.validateDeepSeek(apiKey, userId);
            default:
                return {
                    is_valid: false,
                    error: 'Unknown provider'
                };
        }
    }

    // Get all API keys for a user
    async getUserApiKeys(userId: number): Promise<LLMApiKey[]> {
        const query = `
            SELECT id, user_id, provider, selected_model, reasoning_effort, is_valid, last_validated,
                   validation_error, created_at, updated_at
            FROM llm_api_keys
            WHERE user_id = ?
            ORDER BY provider
        `;

        const keys = await db.query(query, [userId]);

        return keys.map((key: any) => ({
            ...key,
            api_key_masked: '***' // Don't show any part of the key in list view
        }));
    }

    // Get specific API key
    async getApiKey(userId: number, provider: string): Promise<LLMApiKey | null> {
        const query = `
            SELECT id, user_id, provider, selected_model, reasoning_effort, is_valid,
                   last_validated, validation_error, created_at, updated_at
            FROM llm_api_keys
            WHERE user_id = ? AND provider = ?
        `;

        const key = await db.get(query, [userId, provider]);

        if (!key) return null;

        return {
            ...key,
            api_key_masked: '***'
        };
    }

    // Save new API key
    async saveApiKey(userId: number, provider: string, apiKey: string, selectedModel?: string, reasoningEffort: string | null = null): Promise<LLMApiKey> {
        const encrypted = this.encrypt(apiKey);
        const now = new Date().toISOString();

        const query = `
            INSERT INTO llm_api_keys (user_id, provider, api_key_encrypted, selected_model, reasoning_effort, is_valid, last_validated)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(user_id, provider)
            DO UPDATE SET
                api_key_encrypted = excluded.api_key_encrypted,
                selected_model = excluded.selected_model,
                reasoning_effort = excluded.reasoning_effort,
                is_valid = excluded.is_valid,
                last_validated = excluded.last_validated,
                validation_error = NULL,
                updated_at = CURRENT_TIMESTAMP
        `;

        await db.run(query, [userId, provider, encrypted, selectedModel || null, reasoningEffort, now]);

        const savedKey = await this.getApiKey(userId, provider);
        if (!savedKey) {
            throw new Error('Failed to save API key');
        }

        return savedKey;
    }

    // Update existing API key
    async updateApiKey(userId: number, provider: string, apiKey: string, selectedModel?: string, reasoningEffort: string | null = null): Promise<LLMApiKey> {
        if (apiKey) return this.saveApiKey(userId, provider, apiKey, selectedModel, reasoningEffort);
        await db.run(`UPDATE llm_api_keys SET selected_model = ?, reasoning_effort = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND provider = ?`, [selectedModel || null, reasoningEffort, userId, provider]);
        const key = await this.getApiKey(userId, provider);
        if (!key) throw new Error('API key not found');
        return key;
    }

    // Delete API key
    async deleteApiKey(userId: number, provider: string): Promise<void> {
        const query = `DELETE FROM llm_api_keys WHERE user_id = ? AND provider = ?`;
        await db.run(query, [userId, provider]);
    }

    // Get decrypted API key (for internal use only)
    async getDecryptedApiKey(userId: number, provider: string): Promise<string | null> {
        const query = `
            SELECT api_key_encrypted
            FROM llm_api_keys
            WHERE user_id = ? AND provider = ? AND is_valid = 1
        `;

        const result = await db.get(query, [userId, provider]);

        if (!result) return null;

        return this.decrypt(result.api_key_encrypted);
    }
}
