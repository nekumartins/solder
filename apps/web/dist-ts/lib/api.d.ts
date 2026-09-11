export declare class ApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(status: number, code: string, message: string);
}
export declare const api: {
    get: <T>(path: string) => Promise<T>;
    post: <T>(path: string, body?: unknown) => Promise<T>;
    put: <T>(path: string, body?: unknown) => Promise<T>;
};
//# sourceMappingURL=api.d.ts.map