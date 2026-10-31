import axios from 'axios';
import { db } from '../database/database';

export interface Rate { input: number; output: number; cached: number; source: string; checked: string }
const openai = 'https://developers.openai.com/api/docs/pricing';
const google = 'https://ai.google.dev/gemini-api/docs/pricing';
const anthropic = 'https://docs.anthropic.com/en/docs/about-claude/models';
const deepseek = 'https://api-docs.deepseek.com/quick_start/pricing';
const rate = (input: number, output: number, cached: number, source: string): Rate => ({ input, output, cached, source, checked: '2026-09-28' });

// USD / million tokens, standard text requests. Historical requests retain their own snapshot.
export const LLM_RATES: Record<string, Rate> = {
    'openai:gpt-6.1': rate(1.50, 6.00, 0.15, openai),
    'openai:gpt-6.1-mini': rate(0.30, 1.20, 0.03, openai),
    'openai:gpt-6.1-nano': rate(0.08, 0.32, 0.008, openai),
    'openai:gpt-6': rate(1.25, 5.00, 0.125, openai),
    'openai:gpt-6-luna': rate(0.10, 0.50, 0.01, openai),
    'openai:gpt-6-mini': rate(0.25, 1.00, 0.025, openai),
    'openai:gpt-5.4': rate(1.50, 6.00, 0.375, openai),
    'openai:gpt-5.4-mini': rate(0.30, 1.20, 0.075, openai),
    'openai:gpt-5.4-nano': rate(0.08, 0.32, 0.02, openai),
    'openai:gpt-5.2': rate(1.25, 5.00, 0.3125, openai),
    'openai:gpt-5': rate(1.25, 5.00, 0.625, openai),
    'openai:gpt-5-mini': rate(0.25, 2.00, 0.025, openai),
    'openai:gpt-5-nano': rate(0.05, 0.40, 0.005, openai),
    'openai:o3': rate(2.00, 8.00, 0.50, openai),
    'openai:o3-pro': rate(20.00, 80.00, 5.00, openai),
    'openai:o4-mini': rate(1.10, 4.40, 0.275, openai),
    'openai:o3-mini': rate(1.10, 4.40, 0.55, openai),
    'openai:o1': rate(15.00, 60.00, 7.50, openai),
    'openai:gpt-4.1': rate(2.00, 8.00, 0.50, openai),
    'openai:gpt-4.1-mini': rate(0.40, 1.60, 0.10, openai),
    'openai:gpt-4.1-nano': rate(0.10, 0.40, 0.025, openai),
    'openai:gpt-4o': rate(2.50, 10.00, 1.25, 'https://developers.openai.com/api/docs/models/gpt-4o'),
    'openai:gpt-4o-mini': rate(0.15, 0.60, 0.075, 'https://developers.openai.com/api/docs/models/gpt-4o-mini'),
    'gemini:gemini-4-pro': rate(1.50, 8.00, 0.15, google),
    'gemini:gemini-4-flash': rate(0.20, 1.00, 0.02, google),
    'gemini:gemini-4-flash-lite': rate(0.10, 0.40, 0.01, google),
    'gemini:gemini-4-argon': rate(1.25, 6.00, 0.125, google),
    'gemini:gemini-4-ultra': rate(3.50, 14.00, 0.35, google),
    'gemini:gemini-3.5-pro': rate(1.25, 6.00, 0.125, google),
    'gemini:gemini-3.5-flash': rate(0.20, 1.20, 0.02, google),
    'gemini:gemini-3.5-flash-lite': rate(0.30, 2.50, 0.03, google),
    'gemini:gemini-3.1-pro-preview': rate(1.25, 10.00, 0.3125, google),
    'gemini:gemini-3-pro': rate(1.25, 10.00, 0.3125, google),
    'gemini:gemini-3-flash': rate(0.15, 0.60, 0.0375, google),
    'gemini:gemini-3-flash-lite': rate(0.10, 0.40, 0.01, google),
    'gemini:gemini-3-pro-preview': rate(1.25, 10.00, 0.3125, google),
    'gemini:gemini-3-flash-preview': rate(0.15, 0.60, 0.0375, google),
    'gemini:gemini-2.5-pro': rate(1.25, 10.00, 0.3125, google),
    'gemini:gemini-2.5-flash': rate(0.15, 0.60, 0.0375, google),
    'gemini:gemini-2.5-flash-lite': rate(0.10, 0.40, 0.01, google),
    'gemini:gemini-2.5-flash-latest': rate(0.15, 0.60, 0.0375, google),
    'gemini:gemini-2.5-pro-latest': rate(1.25, 5.00, 0.3125, google),
    'gemini:gemini-2.0-flash': rate(0.10, 0.40, 0.025, google),
    'gemini:gemini-2.0-flash-lite': rate(0.075, 0.30, 0.01875, google),
    'claude:claude-5-5-opus': rate(12.00, 60.00, 1.20, anthropic),
    'claude:claude-5-5-sonnet': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-5-5-haiku': rate(0.80, 4.00, 0.08, anthropic),
    'claude:claude-5-opus': rate(15.00, 75.00, 1.50, anthropic),
    'claude:claude-5-sonnet': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-5-haiku': rate(0.80, 4.00, 0.08, anthropic),
    'claude:claude-opus-4-6': rate(15.00, 75.00, 1.50, anthropic),
    'claude:claude-sonnet-4-6': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-opus-4-5': rate(15.00, 75.00, 1.50, anthropic),
    'claude:claude-sonnet-4-5': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-haiku-4-5': rate(1.00, 5.00, 0.10, anthropic),
    'claude:claude-opus-4-1-20250805': rate(15.00, 75.00, 1.50, anthropic),
    'claude:claude-4-opus-20250514': rate(15.00, 75.00, 1.50, anthropic),
    'claude:claude-4-sonnet-20250514': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-3-7-sonnet-latest': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-3-5-sonnet-20241022': rate(3.00, 15.00, 0.30, anthropic),
    'claude:claude-3-5-haiku-20241022': rate(0.80, 4.00, 0.08, anthropic),
    'claude:claude-3-haiku-20240307': rate(0.25, 1.25, 0.025, anthropic),
    'deepseek:deepseek-chat': rate(0.14, 0.28, 0.014, deepseek),
    'deepseek:deepseek-chat-v3': rate(0.14, 0.28, 0.014, deepseek),
    'deepseek:deepseek-coder': rate(0.14, 0.28, 0.014, deepseek),
    'deepseek:deepseek-r2': rate(0.50, 2.00, 0.12, deepseek),
    'deepseek:deepseek-reasoner': rate(0.55, 2.19, 0.14, deepseek)
};

const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function measureUsage(provider: string, model: string, data: any) {
    const usage = provider === 'gemini' ? data?.usageMetadata : data?.usage;
    let input = count(usage?.prompt_tokens), output = count(usage?.completion_tokens);
    let cached = count(usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens) ?? 0;
    let reasoning = count(usage?.completion_tokens_details?.reasoning_tokens) ?? 0;
    if (provider === 'gemini') {
        input = count(usage?.promptTokenCount);
        const candidates = count(usage?.candidatesTokenCount);
        reasoning = count(usage?.thoughtsTokenCount) ?? 0;
        output = candidates === null ? null : candidates + reasoning;
        cached = count(usage?.cachedContentTokenCount) ?? 0;
    } else if (provider === 'claude') {
        input = count(usage?.input_tokens);
        cached = count(usage?.cache_read_input_tokens) ?? 0;
        if (input !== null) input += cached + (count(usage?.cache_creation_input_tokens) ?? 0);
        output = count(usage?.output_tokens);
    }
    const base = LLM_RATES[`${provider}:${model}`];
    const pricing = base ? { ...base } : null;
    if (pricing && model === 'gpt-6-luna' && input !== null && input > 272000) {
        pricing.input *= 2; pricing.cached *= 2; pricing.output *= 1.5;
    }
    const valid = input !== null && output !== null && cached <= input;
    // OpenAI completion_tokens already includes reasoning: do not count it twice.
    const cost = valid && pricing ? ((input! - cached) * pricing.input + cached * pricing.cached + output! * pricing.output) / 1e6 : null;
    return { input, output, cached, reasoning, cost, pricing };
}

export async function trackedLLMPost(
    userId: number,
    provider: string,
    model: string,
    operation: string,
    url: string,
    body: unknown,
    config: { headers: Record<string, string>; timeout: number }
) {
    // Reserve the record before sending; interrupted requests remain visibly pending, never free.
    const record = await db.run(
        'INSERT INTO llm_usage (user_id, provider, model, operation) VALUES (?, ?, ?, ?)',
        [userId, provider, model, operation]
    );
    const recordId = (record as any)?.id;
    let response;
    try {
        response = await axios.post(url, body, config);
    } catch (error) {
        if (recordId) {
            await db.run("UPDATE llm_usage SET status = 'error' WHERE id = ?", [recordId]);
        }
        throw error;
    }
    const usage = measureUsage(provider, model, response.data);
    if (recordId) {
        await db.run(
            `UPDATE llm_usage SET status = 'received', input_tokens = ?, output_tokens = ?,
            cached_tokens = ?, reasoning_tokens = ?, cost_usd = ?, pricing_snapshot = ? WHERE id = ?`,
            [
                usage.input,
                usage.output,
                usage.cached,
                usage.reasoning,
                usage.cost,
                usage.pricing ? JSON.stringify(usage.pricing) : null,
                recordId
            ]
        );
    }
    return response;
}

export async function usageSummary(userId: number, start: string, end: string) {
    const where = 'user_id = ? AND created_at >= ? AND created_at < ?';
    const args = [userId, start, end];
    const columns = `COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS input_tokens,
        COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cached_tokens),0) AS cached_tokens,
        COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens, COALESCE(SUM(cost_usd),0) AS cost_usd,
        COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END),0) AS unpriced,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),0) AS errors`;
    const [total, models, recent, since] = await Promise.all([
        db.get(`SELECT ${columns} FROM llm_usage WHERE ${where}`, args),
        db.query(`SELECT provider, model, ${columns} FROM llm_usage WHERE ${where} GROUP BY provider, model ORDER BY cost_usd DESC`, args),
        db.query(`SELECT id, provider, model, operation, status, input_tokens, output_tokens, cost_usd, created_at FROM llm_usage WHERE ${where} ORDER BY id DESC LIMIT 50`, args),
        db.get('SELECT applied_at FROM schema_migrations WHERE version = 45').catch(() => null)
    ]);
    return { total, models, recent, tracking_since: since?.applied_at ?? null, start, end };
}
