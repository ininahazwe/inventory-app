// server/src/services/loanService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cœur du module « prêts de matériel ». Toutes les écritures sur `loans` passent
// par ici : les routes ne font que valider l'entrée HTTP et appeler ces fonctions
// dans une transaction. Trois raisons :
//   1. la machine à états (qui peut passer de quoi à quoi) vit à un seul endroit ;
//   2. chaque transition écrit son événement dans `loan_events` sans que l'appelant
//      ait à y penser — l'historique ne peut donc pas être « oublié » ;
//   3. les deux invariants de disponibilité (un seul prêt sorti par asset, pas de
//      chevauchement de réservation) sont vérifiés sous verrou `FOR UPDATE` sur la
//      ligne de l'asset, ce qui bloque deux demandes concurrentes.
// ─────────────────────────────────────────────────────────────────────────────
import { BusinessException, ConflictException, NotFoundException } from '../exceptions';
import { todayDateString } from '../utils/dateHelpers';

export type LoanStatus =
    | 'requested'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'checked_out'
    | 'returned';

export type ConditionOut = 'good' | 'fair' | 'damaged';
export type ConditionIn = 'good' | 'fair' | 'damaged' | 'lost';

/** Statuts qui « occupent » l'asset : ils comptent dans la détection de conflit. */
export const BLOCKING_STATUSES: LoanStatus[] = ['requested', 'approved', 'checked_out'];

/** Statuts terminaux : plus aucune transition possible. */
export const CLOSED_STATUSES: LoanStatus[] = ['rejected', 'cancelled', 'returned'];

/**
 * Machine à états du prêt. Tout ce qui n'est pas listé ici est refusé (409 —
 * un conflit d'état, pas une erreur de saisie, d'où ConflictException et non
 * BusinessException, réservée aux entrées invalides qui, elles, sortent en 400),
 * ce qui évite par exemple de sortir un matériel dont la demande a été refusée,
 * ou de rendre deux fois le même prêt.
 */
const ALLOWED_TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
    requested:   ['approved', 'rejected', 'cancelled'],
    approved:    ['checked_out', 'cancelled'],
    checked_out: ['returned'],
    rejected:    [],
    cancelled:   [],
    returned:    [],
};

// Signature minimale commune à db et au `tx` d'une transaction (cf. database/connection.ts).
export type Executor = {
    execute: (sql: string, values?: any[]) => Promise<any>;
    query: (sql: string, values?: any[]) => Promise<any>;
};

export function assertTransition(from: LoanStatus, to: LoanStatus): void {
    if (!ALLOWED_TRANSITIONS[from] || !ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new ConflictException(
            `Cannot move a loan from '${from}' to '${to}'` +
            (CLOSED_STATUSES.includes(from) ? ` — this loan is already closed.` : '')
        );
    }
}

/** Écrit une ligne dans le journal. Appelée par chaque transition — jamais seule. */
export async function recordLoanEvent(
    tx: Executor,
    params: {
        loan_id: number;
        event_type: string;
        from_status?: LoanStatus | null;
        to_status?: LoanStatus | null;
        actor_email?: string | null;
        payload?: Record<string, any> | null;
        notes?: string | null;
    }
): Promise<void> {
    await tx.execute(
        `INSERT INTO loan_events (loan_id, event_type, from_status, to_status, actor_email, payload, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            params.loan_id,
            params.event_type,
            params.from_status || null,
            params.to_status || null,
            params.actor_email || null,
            params.payload ? JSON.stringify(params.payload) : null,
            params.notes || null,
        ]
    );
}

/** Charge un prêt et pose un verrou dessus pour la durée de la transaction. */
export async function loadLoanForUpdate(tx: Executor, loanId: number): Promise<any> {
    const [rows] = await tx.execute('SELECT * FROM loans WHERE id = ? FOR UPDATE', [loanId]);
    const loan = (rows as any[])[0];
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
}

/**
 * Invariant 2 — pas deux prêts non clos qui se chevauchent sur le même asset.
 * Deux intervalles [a1,a2] et [b1,b2] se chevauchent ssi a1 <= b2 ET a2 >= b1.
 */
export async function assertAssetAvailable(
    tx: Executor,
    assetId: number,
    startDate: string,
    dueDate: string,
    excludeLoanId: number | null = null
): Promise<void> {
    const [rows] = await tx.execute(
        `SELECT id, status, start_date, due_date, borrower_email
         FROM loans
         WHERE asset_id = ?
           AND status IN ('requested','approved','checked_out')
           AND start_date <= ?
           AND due_date >= ?
           AND (? IS NULL OR id <> ?)
         ORDER BY start_date ASC
         LIMIT 1`,
        [assetId, dueDate, startDate, excludeLoanId, excludeLoanId]
    );
    const clash = (rows as any[])[0];
    if (clash) {
        throw new ConflictException(
            `This asset is already booked from ${clash.start_date} to ${clash.due_date} ` +
            `(loan #${clash.id}, ${clash.status}, ${clash.borrower_email}).`
        );
    }
}

/** Vérifie que l'asset existe, le verrouille, et refuse les statuts non prêtables. */
async function lockLoanableAsset(tx: Executor, assetId: number): Promise<any> {
    const [rows] = await tx.execute('SELECT id, label, status FROM assets WHERE id = ? FOR UPDATE', [assetId]);
    const asset = (rows as any[])[0];
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status === 'retired' || asset.status === 'auctioned') {
        throw new ConflictException(`Cannot lend an asset with status '${asset.status}'`);
    }
    return asset;
}

function assertDateWindow(startDate: string, dueDate: string): void {
    if (!startDate || !dueDate) throw new BusinessException('start_date and due_date are required');
    if (dueDate < startDate) throw new BusinessException('due_date must be on or after start_date');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. La demande
// ═══════════════════════════════════════════════════════════════════════════
export async function createLoanRequest(
    tx: Executor,
    input: {
        asset_id: number;
        borrower_uid: string | null;
        borrower_email: string;
        start_date: string;
        due_date: string;
        purpose?: string | null;
        requested_by_email: string;
        /** Un admin qui enregistre un prêt pour quelqu'un d'autre peut l'approuver d'emblée. */
        auto_approve?: boolean;
    }
): Promise<{ loanId: number; status: LoanStatus }> {
    assertDateWindow(input.start_date, input.due_date);
    await lockLoanableAsset(tx, input.asset_id);
    await assertAssetAvailable(tx, input.asset_id, input.start_date, input.due_date);

    const status: LoanStatus = input.auto_approve ? 'approved' : 'requested';

    const [result] = await tx.execute(
        `INSERT INTO loans (asset_id, borrower_uid, borrower_email, purpose, start_date, due_date,
                            status, requested_by_email, requested_at, decided_by_email, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
            input.asset_id,
            input.borrower_uid || null,
            input.borrower_email,
            input.purpose || null,
            input.start_date,
            input.due_date,
            status,
            input.requested_by_email,
            input.auto_approve ? input.requested_by_email : null,
            input.auto_approve ? new Date() : null,
        ]
    );
    const loanId = (result as any).insertId;

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: 'requested',
        from_status: null,
        to_status: 'requested',
        actor_email: input.requested_by_email,
        payload: { start_date: input.start_date, due_date: input.due_date, borrower: input.borrower_email },
    });

    if (input.auto_approve) {
        await recordLoanEvent(tx, {
            loan_id: loanId,
            event_type: 'approved',
            from_status: 'requested',
            to_status: 'approved',
            actor_email: input.requested_by_email,
            notes: 'Auto-approved — recorded directly by an administrator',
        });
    }

    return { loanId, status };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. La décision (approbation / refus) et l'annulation
// ═══════════════════════════════════════════════════════════════════════════
export async function decideLoan(
    tx: Executor,
    loanId: number,
    decision: 'approved' | 'rejected',
    actorEmail: string,
    notes?: string | null
): Promise<any> {
    const loan = await loadLoanForUpdate(tx, loanId);
    assertTransition(loan.status, decision);

    // Entre la demande et l'approbation, un autre prêt a pu prendre le créneau.
    if (decision === 'approved') {
        await lockLoanableAsset(tx, loan.asset_id);
        await assertAssetAvailable(tx, loan.asset_id, loan.start_date, loan.due_date, loanId);
    }

    await tx.execute(
        `UPDATE loans SET status = ?, decided_by_email = ?, decided_at = NOW(), decision_notes = ? WHERE id = ?`,
        [decision, actorEmail, notes || null, loanId]
    );

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: decision,
        from_status: loan.status,
        to_status: decision,
        actor_email: actorEmail,
        notes: notes || null,
    });

    return { ...loan, status: decision, decided_by_email: actorEmail, decision_notes: notes || null };
}

export async function cancelLoan(
    tx: Executor,
    loanId: number,
    actorEmail: string,
    reason?: string | null,
    payload?: Record<string, any> | null
): Promise<any> {
    const loan = await loadLoanForUpdate(tx, loanId);
    assertTransition(loan.status, 'cancelled');

    await tx.execute(
        `UPDATE loans SET status = 'cancelled', decision_notes = COALESCE(?, decision_notes) WHERE id = ?`,
        [reason || null, loanId]
    );

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: 'cancelled',
        from_status: loan.status,
        to_status: 'cancelled',
        actor_email: actorEmail,
        payload: payload || null,
        notes: reason || null,
    });

    return { ...loan, status: 'cancelled' };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. La sortie
// ═══════════════════════════════════════════════════════════════════════════
export async function checkoutLoan(
    tx: Executor,
    loanId: number,
    actorEmail: string,
    input: { condition_out?: ConditionOut | null; notes?: string | null }
): Promise<any> {
    const loan = await loadLoanForUpdate(tx, loanId);
    assertTransition(loan.status, 'checked_out');

    const asset = await lockLoanableAsset(tx, loan.asset_id);

    // Invariant 1 : un seul prêt sorti à la fois sur un asset donné.
    const [outRows] = await tx.execute(
        `SELECT id FROM loans WHERE asset_id = ? AND status = 'checked_out' AND id <> ? LIMIT 1`,
        [loan.asset_id, loanId]
    );
    if ((outRows as any[]).length) {
        throw new ConflictException(`Asset is already checked out on loan #${(outRows as any[])[0].id}`);
    }

    // Sortie anticipée : autorisée (cas courant), mais le créneau réellement occupé
    // est [aujourd'hui, retour], pas [start_date, retour] — on le revérifie, puis on
    // recale start_date sur la date réelle pour que le calendrier reste honnête.
    const today = todayDateString();
    const dueDate = String(loan.due_date).slice(0, 10);
    let startDate = String(loan.start_date).slice(0, 10);
    const earlyCheckout = startDate > today;
    if (earlyCheckout) {
        await assertAssetAvailable(tx, loan.asset_id, today, dueDate, loanId);
        startDate = today;
    }

    await tx.execute(
        `UPDATE loans
         SET status = 'checked_out', checked_out_at = NOW(), checked_out_by_email = ?,
             condition_out = ?, asset_status_before = ?, start_date = ?, notes = COALESCE(?, notes)
         WHERE id = ?`,
        [actorEmail, input.condition_out || 'good', asset.status, startDate, input.notes || null, loanId]
    );

    // Le statut d'origine est mémorisé pour être restitué au retour : un matériel
    // affecté à quelqu'un redevient 'assigned', un matériel en stock 'in_stock'.
    await tx.execute(`UPDATE assets SET status = 'on_loan' WHERE id = ?`, [loan.asset_id]);

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: 'checked_out',
        from_status: loan.status,
        to_status: 'checked_out',
        actor_email: actorEmail,
        payload: {
            condition_out: input.condition_out || 'good',
            asset_status_before: asset.status,
            ...(earlyCheckout ? { early_checkout: true, planned_start_date: String(loan.start_date).slice(0, 10) } : {}),
        },
        notes: input.notes || null,
    });

    return { ...loan, status: 'checked_out', asset_label: asset.label };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. La prolongation
// ═══════════════════════════════════════════════════════════════════════════
export async function extendLoan(
    tx: Executor,
    loanId: number,
    actorEmail: string,
    newDueDate: string,
    reason?: string | null
): Promise<any> {
    const loan = await loadLoanForUpdate(tx, loanId);
    if (loan.status !== 'approved' && loan.status !== 'checked_out') {
        throw new ConflictException(`Only an approved or checked-out loan can be extended (this one is '${loan.status}')`);
    }
    if (newDueDate <= loan.due_date) {
        throw new BusinessException('The new due date must be later than the current one');
    }

    // La prolongation peut empiéter sur une réservation suivante : même contrôle
    // que pour une nouvelle demande, sur la fenêtre élargie.
    await assertAssetAvailable(tx, loan.asset_id, loan.start_date, newDueDate, loanId);

    await tx.execute(
        `UPDATE loans
         SET due_date = ?, extended_count = extended_count + 1, overdue_reminder_sent_at = NULL
         WHERE id = ?`,
        [newDueDate, loanId]
    );

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: 'extended',
        from_status: loan.status,
        to_status: loan.status,
        actor_email: actorEmail,
        payload: { previous_due_date: loan.due_date, new_due_date: newDueDate },
        notes: reason || null,
    });

    return { ...loan, due_date: newDueDate, extended_count: (loan.extended_count || 0) + 1 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Le retour
// ═══════════════════════════════════════════════════════════════════════════
export async function checkinLoan(
    tx: Executor,
    loanId: number,
    actorEmail: string,
    input: {
        condition_in: ConditionIn;
        return_location_id?: number | null;
        notes?: string | null;
        /** Ouvre un incident lié quand le matériel revient abîmé ou ne revient pas. */
        open_incident?: boolean;
    }
): Promise<{ loan: any; incidentId: number | null; assetStatus: string }> {
    const loan = await loadLoanForUpdate(tx, loanId);
    assertTransition(loan.status, 'returned');

    const condition = input.condition_in;
    if (!['good', 'fair', 'damaged', 'lost'].includes(condition)) {
        throw new BusinessException("condition_in must be one of 'good', 'fair', 'damaged', 'lost'");
    }

    // Un matériel perdu ne retourne pas en stock : il part en réparation/retrait
    // plutôt que de réapparaître comme disponible dans l'inventaire.
    const restoredStatus =
        condition === 'lost'     ? 'retired'
      : condition === 'damaged'  ? 'repair'
      : (loan.asset_status_before || 'in_stock');

    let incidentId: number | null = null;
    if (input.open_incident && (condition === 'damaged' || condition === 'lost')) {
        const [incRes] = await tx.execute(
            `INSERT INTO incidents (asset_id, incident_type, severity, description, status, reported_by_email, created_at)
             VALUES (?, ?, ?, ?, 'open', ?, NOW())`,
            [
                loan.asset_id,
                condition === 'lost' ? 'loss' : 'damage',
                condition === 'lost' ? 'critical' : 'high',
                `Reported on return of loan #${loanId} (borrower: ${loan.borrower_email}).` +
                (input.notes ? ` ${input.notes}` : ''),
                actorEmail,
            ]
        );
        incidentId = (incRes as any).insertId || null;
    }

    await tx.execute(
        `UPDATE loans
         SET status = 'returned', returned_at = NOW(), received_by_email = ?, condition_in = ?,
             return_location_id = ?, incident_id = ?, notes = COALESCE(?, notes)
         WHERE id = ?`,
        [actorEmail, condition, input.return_location_id || null, incidentId, input.notes || null, loanId]
    );

    await tx.execute(`UPDATE assets SET status = ? WHERE id = ?`, [restoredStatus, loan.asset_id]);

    const dueDate = String(loan.due_date).slice(0, 10);
    const daysLate = Math.max(0, Math.floor((Date.now() - new Date(`${dueDate}T23:59:59`).getTime()) / 86400000));

    await recordLoanEvent(tx, {
        loan_id: loanId,
        event_type: 'returned',
        from_status: loan.status,
        to_status: 'returned',
        actor_email: actorEmail,
        payload: {
            condition_in: condition,
            days_late: daysLate,
            asset_status_restored: restoredStatus,
            incident_id: incidentId,
        },
        notes: input.notes || null,
    });

    return { loan: { ...loan, status: 'returned' }, incidentId, assetStatus: restoredStatus };
}
