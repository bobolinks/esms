import { Express } from 'express';
export interface EsmsPlugin {
    test: RegExp;
    transform(context: EsmServer, path: string, content?: string): string;
}
export interface EsmsOptions {
    port?: number;
    index?: string;
    plugins?: Array<EsmsPlugin>;
}
export declare class EsmServer {
    root: string;
    expr: Express;
    app: any;
    options: EsmsOptions;
    constructor(root: string, options?: EsmsOptions);
    start(): void;
}
