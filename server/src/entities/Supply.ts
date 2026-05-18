export interface Supply {
    id: number;
    name: string;
    purchase_date: string;           // YYYY-MM-DD
    cost: number;
    brand?: string;
    quantity: number;
    receiver_uid: string;            // UUID
    created_by_uid: string;          // UUID
    created_at: string;              // ISO timestamp
    updated_at: string;
}

export interface CreateSupplyRequest {
    name: string;
    purchase_date: string;           // YYYY-MM-DD
    cost: number;
    brand?: string;
    quantity: number;
    receiver_uid: string;            // UUID (dropdown users)
}

export interface UpdateSupplyRequest {
    name?: string;
    purchase_date?: string;
    cost?: number;
    brand?: string;
    quantity?: number;
    receiver_uid?: string;
}

export interface SupplyListResponse {
    supplies: Supply[];
    totalCost: number;               // SUM(cost * quantity)
    totalQuantity: number;           // SUM(quantity)
    totalItems: number;              // COUNT
}