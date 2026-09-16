// server/src/services/supplyLedger.ts
//
// Service unique d'écriture du ledger fournitures (Phase 3). Toute écriture
// dans supply_stock_ledger passe par une des fonctions ci-dessous, dans la
// même transaction que le document qui la justifie (invariant 3). Depuis la
// migration 2026-09-16-phase3-ledger-lockdown.sql, le compte applicatif n'a
// de toute façon plus le droit d'UPDATE/DELETE sur supply_stock_ledger — mais
// la règle ne doit pas dépendre uniquement de ce filet.
//
// Toute correction passe par une écriture inverse (invariant 2) : voir
// postReturn(), qui référence la ligne qu'elle annule via `reverses_id`,
// jamais par un UPDATE de la ligne d'origine.
import { db } from '../database/connection';
import { NotFoundException, BusinessException } from '../exceptions';

export type Executor = { execute: (sql: string, values?: any[]) => Promise<any> };

export interface StockRow {
    item_id: number;
    qty_on_hand: number;
    value_on_hand: number;
    avg_unit_cost: number | null;
}

// ─── Lecture ────────────────────────────────────────────────────────────────

export async function getStock(itemId?: number, executor: Executor = db): Promise<StockRow[]> {
    if (itemId) {
        const [rows] = await executor.execute(`SELECT * FROM v_supply_stock WHERE item_id = ?`, [itemId]);
        return rows as StockRow[];
    }
    const [rows] = await executor.execute(`SELECT * FROM v_supply_stock`);
    return rows as StockRow[];
}

// Coût moyen pondéré courant de l'article (SUM(value)/SUM(quantity_base) sur
// tout le ledger de l'article) — c'est la valorisation "moving average" utilisée
// pour toute nouvelle sortie, retour ou ajustement, conformément à la note de
// valorisation de la Phase 2 (à partir de la Phase 3, plus d'approximation :
// le vrai coût moyen courant est utilisé, pas le coût moyen des seules réceptions).
async function currentAvgCost(itemId: number, executor: Executor): Promise<number> {
    const [rows] = await executor.execute(
        `SELECT CASE WHEN SUM(quantity_base) = 0 THEN NULL ELSE SUM(value) / SUM(quantity_base) END AS avg_cost
         FROM supply_stock_ledger WHERE item_id = ?`,
        [itemId]
    );
    const avg = (rows as any[])[0]?.avg_cost;
    return avg === null || avg === undefined ? 0 : Number(avg);
}

async function currentOnHand(itemId: number, executor: Executor): Promise<number> {
    const [rows] = await executor.execute(
        `SELECT COALESCE(SUM(quantity_base), 0) AS qty FROM supply_stock_ledger WHERE item_id = ?`,
        [itemId]
    );
    return Number((rows as any[])[0]?.qty || 0);
}

// Sérialise les écritures concurrentes sur un même article (même rôle que le
// `SELECT ... FOR UPDATE` sur `supplies` dans l'ancien modèle) — nécessaire
// avant tout calcul de coût moyen ou de stock disponible dans la même transaction.
async function lockItem(itemId: number, executor: Executor): Promise<void> {
    const [rows] = await executor.execute(`SELECT id FROM supply_items WHERE id = ? FOR UPDATE`, [itemId]);
    if (!(rows as any[]).length) {
        throw new NotFoundException(`Item ${itemId} not found`);
    }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ─── Réceptions ─────────────────────────────────────────────────────────────

export interface ReceiptLineInput {
    item_id: number;
    pack_size?: number;
    packs_received: number;
    quantity_base: number;
    line_total: number;
    unit_cost_base: number;
    batch_code?: string | null;
    expiry_date?: string | null;
    brand?: string | null;
    legacy_supply_id?: number | null;
}

export interface ReceiptInput {
    received_date: string;
    reference?: string | null;
    supplier_id?: number | null;
    invoice_ref?: string | null;
    received_by_uid?: string | null;
    lines: ReceiptLineInput[];
}

export async function postReceipt(input: ReceiptInput, executor: Executor = db): Promise<{ receiptId: number; lineIds: number[] }> {
    if (!input.lines.length) {
        throw new BusinessException('A receipt needs at least one line');
    }

    const [result] = await executor.execute(
        `INSERT INTO supply_receipts (reference, supplier_id, received_date, invoice_ref, received_by_uid)
         VALUES (?, ?, ?, ?, ?)`,
        [input.reference || null, input.supplier_id || null, input.received_date, input.invoice_ref || null, input.received_by_uid || null]
    );
    const receiptId = (result as any).insertId;
    const lineIds: number[] = [];

    for (const line of input.lines) {
        await lockItem(line.item_id, executor);

        const [lineResult] = await executor.execute(
            `INSERT INTO supply_receipt_lines
                (receipt_id, item_id, pack_size, packs_received, quantity_base, line_total, unit_cost_base, brand, batch_code, expiry_date, legacy_supply_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                receiptId, line.item_id, line.pack_size ?? 1, line.packs_received, line.quantity_base,
                line.line_total, line.unit_cost_base, line.brand || null, line.batch_code || null,
                line.expiry_date || null, line.legacy_supply_id || null,
            ]
        );
        const lineId = (lineResult as any).insertId;
        lineIds.push(lineId);

        await executor.execute(
            `INSERT INTO supply_stock_ledger
                (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
             VALUES (?, ?, 'receipt', ?, ?, ?, NULL, 'supply_receipt_lines', ?)`,
            [line.item_id, input.received_date, line.quantity_base, line.unit_cost_base, round2(line.quantity_base * line.unit_cost_base), lineId]
        );
    }

    return { receiptId, lineIds };
}

// ─── Sorties ────────────────────────────────────────────────────────────────

export interface IssueLineInput {
    item_id: number;
    quantity_base: number;
    batch_id?: number | null;
    legacy_assignment_id?: number | null;
}

export interface IssueInput {
    issue_date: string;
    reference?: string | null;
    destination_location_id?: number | null;
    recipient_uid?: string | null;
    issued_by_uid?: string | null;
    purpose?: string | null;
    lines: IssueLineInput[];
}

export async function postIssue(input: IssueInput, executor: Executor = db): Promise<{ issueId: number; lineIds: number[] }> {
    if (!input.lines.length) {
        throw new BusinessException('An issue needs at least one line');
    }

    const [result] = await executor.execute(
        `INSERT INTO supply_issues (reference, issue_date, destination_location_id, recipient_uid, issued_by_uid, purpose)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.reference || null, input.issue_date, input.destination_location_id || null, input.recipient_uid || null, input.issued_by_uid || null, input.purpose || null]
    );
    const issueId = (result as any).insertId;
    const lineIds: number[] = [];

    for (const line of input.lines) {
        await lockItem(line.item_id, executor);

        const onHand = await currentOnHand(line.item_id, executor);
        if (line.quantity_base > onHand) {
            throw new BusinessException(`Only ${onHand} units available`);
        }
        const avgCost = await currentAvgCost(line.item_id, executor);

        const [lineResult] = await executor.execute(
            `INSERT INTO supply_issue_lines (issue_id, item_id, quantity_base, batch_id, legacy_assignment_id)
             VALUES (?, ?, ?, ?, ?)`,
            [issueId, line.item_id, line.quantity_base, line.batch_id || null, line.legacy_assignment_id || null]
        );
        const lineId = (lineResult as any).insertId;
        lineIds.push(lineId);

        await executor.execute(
            `INSERT INTO supply_stock_ledger
                (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
             VALUES (?, ?, 'issue', ?, ?, ?, ?, 'supply_issue_lines', ?)`,
            [line.item_id, input.issue_date, -line.quantity_base, avgCost, round2(-line.quantity_base * avgCost), input.destination_location_id || null, lineId]
        );
    }

    return { issueId, lineIds };
}

// ─── Retours ────────────────────────────────────────────────────────────────
// Un retour est une écriture inverse qui référence explicitement la sortie
// qu'elle annule (reverses_id), jamais une modification de la ligne de sortie
// d'origine (invariant 2). Partiel ou total : plusieurs retours peuvent viser
// la même ligne de sortie tant que leur somme ne dépasse pas la quantité sortie.
export async function postReturn(
    params: { issue_line_id: number; quantity_base: number; return_date: string },
    executor: Executor = db
): Promise<number> {
    if (params.quantity_base <= 0) {
        throw new BusinessException('quantity_base must be a positive integer');
    }

    const [lineRows] = await executor.execute(
        `SELECT il.id, il.item_id, il.quantity_base AS issued_qty, q.destination_location_id
         FROM supply_issue_lines il
         JOIN supply_issues q ON q.id = il.issue_id
         WHERE il.id = ?
         FOR UPDATE`,
        [params.issue_line_id]
    );
    if (!(lineRows as any[]).length) {
        throw new NotFoundException('Issue line not found');
    }
    const line = (lineRows as any[])[0];

    const [origRows] = await executor.execute(
        `SELECT id, unit_cost_base FROM supply_stock_ledger WHERE source_table = 'supply_issue_lines' AND source_line_id = ?`,
        [params.issue_line_id]
    );
    if (!(origRows as any[]).length) {
        throw new NotFoundException('Original ledger entry not found for this issue line');
    }
    const orig = (origRows as any[])[0];

    const [returnedRows] = await executor.execute(
        `SELECT COALESCE(SUM(quantity_base), 0) AS already_returned
         FROM supply_stock_ledger WHERE reason = 'return' AND reverses_id = ?`,
        [orig.id]
    );
    const alreadyReturned = Number((returnedRows as any[])[0]?.already_returned || 0);
    if (alreadyReturned + params.quantity_base > line.issued_qty) {
        throw new BusinessException(`Cannot return more than the ${line.issued_qty - alreadyReturned} units still outstanding`);
    }

    const [result] = await executor.execute(
        `INSERT INTO supply_stock_ledger
            (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id, reverses_id)
         VALUES (?, ?, 'return', ?, ?, ?, ?, 'supply_issue_lines', ?, ?)`,
        [
            line.item_id, params.return_date, params.quantity_base, orig.unit_cost_base,
            round2(params.quantity_base * orig.unit_cost_base), line.destination_location_id,
            params.issue_line_id, orig.id,
        ]
    );
    return (result as any).insertId;
}

// ─── Ajustements ────────────────────────────────────────────────────────────

export interface AdjustmentLineInput {
    item_id: number;
    counted_quantity: number;
    notes?: string | null;
    legacy_movement_id?: number | null;
}

export interface AdjustmentInput {
    adjustment_date: string;
    source: 'count' | 'event';
    reason: 'loss' | 'breakage' | 'expiry' | 'error' | 'found';
    recorded_by_uid?: string | null;
    lines: AdjustmentLineInput[];
}

export async function postAdjustment(input: AdjustmentInput, executor: Executor = db): Promise<{ adjustmentId: number; lineIds: number[] }> {
    if (!input.lines.length) {
        throw new BusinessException('An adjustment needs at least one line');
    }

    const [result] = await executor.execute(
        `INSERT INTO supply_adjustments (adjustment_date, source, recorded_by_uid, status, reason)
         VALUES (?, ?, ?, 'posted', ?)`,
        [input.adjustment_date, input.source, input.recorded_by_uid || null, input.reason]
    );
    const adjustmentId = (result as any).insertId;
    const lineIds: number[] = [];

    for (const line of input.lines) {
        await lockItem(line.item_id, executor);

        const systemQty = await currentOnHand(line.item_id, executor);
        const variance = line.counted_quantity - systemQty;

        const [lineResult] = await executor.execute(
            `INSERT INTO supply_adjustment_lines (adjustment_id, item_id, system_quantity, counted_quantity, variance, notes, legacy_movement_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [adjustmentId, line.item_id, systemQty, line.counted_quantity, variance, line.notes || null, line.legacy_movement_id || null]
        );
        const lineId = (lineResult as any).insertId;
        lineIds.push(lineId);

        if (variance !== 0) {
            const avgCost = await currentAvgCost(line.item_id, executor);
            await executor.execute(
                `INSERT INTO supply_stock_ledger
                    (item_id, movement_date, reason, quantity_base, unit_cost_base, value, location_id, source_table, source_line_id)
                 VALUES (?, ?, 'count_variance', ?, ?, ?, NULL, 'supply_adjustment_lines', ?)`,
                [line.item_id, input.adjustment_date, variance, avgCost, round2(variance * avgCost), lineId]
            );
        }
    }

    return { adjustmentId, lineIds };
}
