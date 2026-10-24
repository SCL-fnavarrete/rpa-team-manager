import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ParamsDictionary } from 'express-serve-static-core';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

export interface ValidationTarget {
    body?: z.ZodSchema;
    params?: z.ZodSchema;
    query?: z.ZodSchema;
}

export interface ValidationOptions {
    // Responde 400 { success: false, error } con el primer mensaje del esquema, en vez de delegar en el
    // manejador global (que solo informa "Validation failed"). Para rutas cuyos mensajes ya van en español.
    inlineErrors?: boolean;
}

// Generic validation middleware factory
export const validate = (schemas: ValidationTarget, options: ValidationOptions = {}) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // Validate request body
            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }

            // Validate URL parameters
            if (schemas.params) {
                req.params = await schemas.params.parseAsync(req.params) as ParamsDictionary;
            }

            // Validate query parameters
            if (schemas.query) {
                const validatedQuery = await schemas.query.parseAsync(req.query);
                req.query = validatedQuery as any;
            }

            return next();
        } catch (error) {
            if (error instanceof ZodError) {
                const validationErrors = error.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                    code: issue.code,
                    received: 'input' in issue ? (issue as any).received : undefined
                }));

                logger.warn('Validation failed:', {
                    url: req.url,
                    method: req.method,
                    errors: validationErrors,
                    ip: req.ip
                });

                if (options.inlineErrors) {
                    res.status(400).json({ success: false, error: validationErrors[0]?.message ?? 'Datos inválidos' });
                    return;
                }

                const validationError = new ValidationError('Validation failed');
                return next(validationError);
            }

            // Log unexpected validation errors
            logger.error('Unexpected validation error:', {
                url: req.url,
                method: req.method,
                error: error instanceof Error ? error.message : 'Unknown error',
                ip: req.ip
            });

            return next(error);
        }
    };
};

// Sanitize input by removing potential XSS and injection attempts
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
    const sanitizeValue = (value: any): any => {
        if (typeof value === 'string') {
            // Remove potential XSS attempts
            return value
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+\s*=/gi, '')
                .trim();
        }
        
        if (Array.isArray(value)) {
            return value.map(sanitizeValue);
        }
        
        if (typeof value === 'object' && value !== null) {
            const sanitized: any = {};
            for (const [key, val] of Object.entries(value)) {
                sanitized[key] = sanitizeValue(val);
            }
            return sanitized;
        }
        
        return value;
    };

    try {
        if (req.body && typeof req.body === 'object') {
            req.body = sanitizeValue(req.body);
        }
        
        if (req.query && typeof req.query === 'object') {
            req.query = sanitizeValue(req.query);
        }
        
        if (req.params && typeof req.params === 'object') {
            req.params = sanitizeValue(req.params);
        }
        
        return next();
    } catch (error) {
        logger.error('Input sanitization error:', error);
        res.status(500).json({
            error: {
                message: 'Input processing error',
                code: 'SANITIZATION_ERROR',
                timestamp: new Date().toISOString()
            }
        });
        return;
    }
};

// Prevent common attack patterns
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Prevent caching of sensitive data
    if (req.url.includes('/api/')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
    }
    
    return next();
};