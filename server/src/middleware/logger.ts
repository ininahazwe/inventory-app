/**
 * Logger utility for server-side logging
 * Used by Services, Repositories, and Middleware
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: string;
    data?: any;
}

class Logger {
    private isDevelopment = process.env.NODE_ENV === 'development';

    private formatLog(level: LogLevel, message: string, context?: string, data?: any): LogEntry {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            data,
        };
    }

    private log(entry: LogEntry) {
        const prefix = entry.context ? `[${entry.context}]` : '';
        const message = `${entry.timestamp} ${entry.level.toUpperCase()} ${prefix} ${entry.message}`;

        if (entry.data) {
            if (this.isDevelopment) {
                console.log(message, entry.data);
            } else {
                console.log(message);
            }
        } else {
            console.log(message);
        }
    }

    info(message: string, context?: string, data?: any) {
        const entry = this.formatLog('info', message, context, data);
        this.log(entry);
    }

    warn(message: string, context?: string, data?: any) {
        const entry = this.formatLog('warn', message, context, data);
        this.log(entry);
    }

    error(message: string, error?: any) {
        const entry = this.formatLog('error', message, 'ERROR', error);
        console.error(entry.timestamp, 'ERROR', message, error);
    }

    debug(message: string, context?: string, data?: any) {
        if (this.isDevelopment) {
            const entry = this.formatLog('debug', message, context, data);
            this.log(entry);
        }
    }
}

export const logger = new Logger();