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
            // ✅ Colonnes DATE (purchase_date, purchased_at, warranty_end, assigned_at,
            // returned_at, movement_date) renvoyées en chaîne 'YYYY-MM-DD' brute plutôt
            // qu'en objet Date. Sans ça, mysql2 construit un Date en fuseau "local" du
            // process serveur puis res.json() le sérialise en UTC (toISOString), ce qui
            // peut décaler le jour d'une unité selon le fuseau/heure du serveur au moment
            // de la requête. Les DATETIME/TIMESTAMP (created_at, start_date/end_date...)
            // gardent le comportement Date normal — ce sont de vrais instants, pas des
            // dates calendaires, donc pas de risque de décalage de jour.
            dateStrings: ['DATE'],
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

/**
 * Exécute plusieurs requêtes de manière atomique sur UNE connexion dédiée.
 * BEGIN -> fn(tx) -> COMMIT, ou ROLLBACK si fn lève une erreur.
 * tx.execute / tx.query ont la même signature que db.execute / db.query,
 * mais tournent sur la connexion en transaction (pas le pool).
 */
transaction: async <T>(
    fn: (tx: {
        execute: (sql: string, values?: any[]) => Promise<[mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.OkPacket | mysql.OkPacket[], mysql.FieldPacket[]]>;
        query: (sql: string, values?: any[]) => Promise<[mysql.RowDataPacket[], mysql.FieldPacket[]]>;
    }) => Promise<T>
): Promise<T> => {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        const tx = {
            execute: (sql: string, values?: any[]) => connection.execute(sql, values || []),
            query: (sql: string, values?: any[]) => connection.query(sql, values || []),
        };
        const result = await fn(tx as any);
        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
},
};