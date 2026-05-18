import { db } from '../database/connection';
import type {Supply, CreateSupplyRequest, UpdateSupplyRequest} from '../entities/Supply';
import { NotFoundException } from '../exceptions';
import { logger } from '../middleware/logger';

export class SupplyRepository {

    async create(dto: CreateSupplyRequest, createdByUid: string): Promise<Supply> {
        try {
            const [result] = await db.execute(
                `INSERT INTO supplies (name, purchase_date, cost, brand, quantity, receiver_uid, created_by_uid)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [dto.name, dto.purchase_date, dto.cost, dto.brand || null, dto.quantity, dto.receiver_uid, createdByUid]
            );

            const supply = await this.findById((result as any).insertId);
            if (!supply) throw new NotFoundException('Failed to create supply');
            return supply;
        } catch (error) {
            logger.error('[SUPPLY_CREATE_ERROR]', error);
            throw error;
        }
    }

    async findById(id: number): Promise<Supply | null> {
        const [rows] = await db.execute('SELECT * FROM supplies WHERE id = ? LIMIT 1', [id]);
        return (rows as Supply[])[0] || null;
    }

    async findAll(filters?: {
        receiver_uid?: string;
        brand?: string;
        from_date?: string;
        to_date?: string;
        limit?: number;
        offset?: number;
    }): Promise<Supply[]> {
        let query = 'SELECT * FROM supplies WHERE 1=1';
        const params: any[] = [];

        if (filters?.receiver_uid) {
            query += ' AND receiver_uid = ?';
            params.push(filters.receiver_uid);
        }
        if (filters?.brand) {
            query += ' AND brand = ?';
            params.push(filters.brand);
        }
        if (filters?.from_date) {
            query += ' AND purchase_date >= ?';
            params.push(filters.from_date);
        }
        if (filters?.to_date) {
            query += ' AND purchase_date <= ?';
            params.push(filters.to_date);
        }

        query += ' ORDER BY purchase_date DESC';

        if (filters?.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }
        if (filters?.offset) {
            query += ' OFFSET ?';
            params.push(filters.offset);
        }

        const [rows] = await db.execute(query, params);
        return rows as Supply[];
    }

    async update(id: number, dto: UpdateSupplyRequest): Promise<void> {
        const fields = Object.keys(dto)
            .filter(k => dto[k as keyof UpdateSupplyRequest] !== undefined)
            .map(k => `${k} = ?`);

        if (fields.length === 0) return;

        const values = Object.keys(dto)
            .filter(k => dto[k as keyof UpdateSupplyRequest] !== undefined)
            .map(k => dto[k as keyof UpdateSupplyRequest]);

        await db.execute(
            `UPDATE supplies SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
            [...values, id]
        );
    }

    async delete(id: number): Promise<void> {
        await db.execute('DELETE FROM supplies WHERE id = ?', [id]);
    }

    async getTotalCost(filters?: any): Promise<number> {
        let query = 'SELECT COALESCE(SUM(cost * quantity), 0) as total FROM supplies WHERE 1=1';
        const params: any[] = [];

        if (filters?.receiver_uid) {
            query += ' AND receiver_uid = ?';
            params.push(filters.receiver_uid);
        }
        if (filters?.brand) {
            query += ' AND brand = ?';
            params.push(filters.brand);
        }
        if (filters?.from_date) {
            query += ' AND purchase_date >= ?';
            params.push(filters.from_date);
        }
        if (filters?.to_date) {
            query += ' AND purchase_date <= ?';
            params.push(filters.to_date);
        }

        const [rows] = await db.execute(query, params);
        return parseFloat((rows as any[])[0]?.total) || 0;
    }

    async getTotalQuantity(filters?: any): Promise<number> {
        let query = 'SELECT COALESCE(SUM(quantity), 0) as total FROM supplies WHERE 1=1';
        const params: any[] = [];

        if (filters?.receiver_uid) {
            query += ' AND receiver_uid = ?';
            params.push(filters.receiver_uid);
        }
        if (filters?.brand) {
            query += ' AND brand = ?';
            params.push(filters.brand);
        }
        if (filters?.from_date) {
            query += ' AND purchase_date >= ?';
            params.push(filters.from_date);
        }
        if (filters?.to_date) {
            query += ' AND purchase_date <= ?';
            params.push(filters.to_date);
        }

        const [rows] = await db.execute(query, params);
        return parseInt((rows as any[])[0]?.total) || 0;
    }
}