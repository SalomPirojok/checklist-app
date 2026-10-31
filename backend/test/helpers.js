import { vi } from 'vitest';

// Minimal Express res stand-in for calling middleware directly.
export function mockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

export async function runMiddleware(middleware, req) {
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
}
