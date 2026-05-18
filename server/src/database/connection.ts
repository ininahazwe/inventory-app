/**
 * MySQL connection pool using mysql2/promise
 * Provides db.execute() for queries
 */

import mysql from 'mysql2/promise';
import { logger } from '../middleware/logger.js';

let pool: mysql.Pool | null = null;

export async function initializePool() {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'assetmngt',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        });

        logger.info('Database pool initialized', 'DB_INIT');
        return pool;
    } catch (error) {
        logger.error('Failed to initialize database pool', error);
        throw error;
    }
}

export function getPool(): mysql.Pool {
    if (!pool) {
        throw new Error('Database pool not initialized. Call initializePool() first.');
    }
    return pool;
}

export const db = {
    execute: async (
        sql: string,
        values?: any[]
): Promise<[mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.OkPacket | mysql.OkPacket[], mysql.FieldPacket[]]> => {
    const connection = await getPool().getConnection();
    try {
        return await connection.execute(sql, values || []);
    } finally {
        connection.release();
    }
},

query: async (
    sql: string,
    values?: any[]
): Promise<[mysql.RowDataPacket[], mysql.FieldPacket[]]> => {
    const connection = await getPool().getConnection();
    try {
        return await connection.query(sql, values || []);
    } finally {
        connection.release();
    }
},
};