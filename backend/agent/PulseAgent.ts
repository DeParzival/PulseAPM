import * as os from 'os';

export interface Breadcrumb {
    message: string;
    category: string;
    level: 'info' | 'warn' | 'error';
    timestamp: string;
}

export interface AgentTelemetry {
    nodeVersion: string;
    platform: string;
    arch: string;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    uptimeSeconds: number;
    memoryUsage: NodeJS.MemoryUsage;
}

export class PulseAgent {
    private ingestUrl: string;
    private serviceName: string;
    private apiKey: string;
    private environment: string;

    // Rolling list of historical actions leading to an exception (capped at 15 items)
    private breadcrumbs: Breadcrumb[] = [];
    private readonly MAX_BREADCRUMBS = 15;

    constructor(
        serviceName: string, 
        apiKey: string, 
        environment: string = 'production',
        ingestUrl: string = 'http://localhost:3000/api/logs'
    ) {
        this.ingestUrl = ingestUrl;
        this.serviceName = serviceName;
        this.apiKey = apiKey;
        this.environment = environment;
    }

    /**
     * Start the interceptor loops and hook into logging workflows.
     */
    public start() {
        console.log(`[Pulse-APM] Agent started for service: ${this.serviceName} (${this.environment})`);

        // 1. Automatically harvest standard console logs/warns as breadcrumbs
        this.monkeyPatchConsole();

        // 2. Intercept unhandled application crashes (The Airbag)
        process.on('uncaughtException', (error: Error) => {
            this.captureException(error, 'FATAL_UNCAUGHT_EXCEPTION');
            
            // Give standard stream outputs a moment to flush before exiting
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        });

        // 3. Intercept unhandled Promise rejections
        process.on('unhandledRejection', (reason: any) => {
            const errorInstance = reason instanceof Error ? reason : new Error(String(reason));
            this.captureException(errorInstance, 'UNHANDLED_PROMISE_REJECTION');
        });
    }

    /**
     * Manually record an administrative custom breadcrumb
     */
    public leaveBreadcrumb(message: string, category: string = 'manual', level: 'info' | 'warn' | 'error' = 'info') {
        const breadcrumb: Breadcrumb = {
            message,
            category,
            level,
            timestamp: new Date().toISOString()
        };

        this.breadcrumbs.push(breadcrumb);

        // Slide the array window to maintain constraints
        if (this.breadcrumbs.length > this.MAX_BREADCRUMBS) {
            this.breadcrumbs.shift();
        }
    }

    /**
     * Helper mapping interceptors onto default node process console methods
     */
    private monkeyPatchConsole() {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        // Trace standard output records into breadcrumbs
        console.log = (...args: any[]) => {
            const text = this.formatLogArgs(args);
            this.leaveBreadcrumb(text, 'console', 'info');
            originalLog.apply(console, args);
        };

        console.warn = (...args: any[]) => {
            const text = this.formatLogArgs(args);
            this.leaveBreadcrumb(text, 'console', 'warn');
            originalWarn.apply(console, args);
        };

        console.error = (...args: any[]) => {
            const text = this.formatLogArgs(args);
            
            // Directly capture this as an error event to report back to Pulse-APM
            this.sendError(text, {
                name: 'ConsoleError',
                message: text,
                stack: new Error().stack || ''
            });

            originalError.apply(console, args);
        };
    }

    private formatLogArgs(args: any[]): string {
        return args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    }

    /**
     * Programmatic API trigger to let developers capture manual catch-block try-catches
     */
    public captureException(error: Error, category: string = 'manual-capture') {
        this.leaveBreadcrumb(`Captured Exception: ${error.message}`, category, 'error');
        this.sendError(error.message, error);
    }

    /**
     * Gather system health environment metadata snapshots at time of crash
     */
    private getSystemTelemetry(): AgentTelemetry {
        return {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            freeMemoryBytes: os.freemem(),
            totalMemoryBytes: os.totalmem(),
            uptimeSeconds: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }

    /**
     * Package context maps and post payloads to the core ingestion api
     */
    private async sendError(errorMessage: string, errorObj?: Error | { name: string, message: string, stack: string }) {
        const payload = {
            message: errorMessage,
            service: this.serviceName,
            environment: this.environment,
            error: errorObj ? {
                name: errorObj.name,
                message: errorObj.message,
                stack: errorObj.stack
            } : null,
            breadcrumbs: [...this.breadcrumbs],
            telemetry: this.getSystemTelemetry()
        };

        try {
            await fetch(this.ingestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey // API Security authorization token
                },
                body: JSON.stringify(payload)
            });
        } catch (postError) {
            // Keep failures silent inside the host app context to prevent cascading failure loops
        }
    }
}