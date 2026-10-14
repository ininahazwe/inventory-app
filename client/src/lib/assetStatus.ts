// Single source of truth for how asset statuses are shown to users.
export type AssetStatus = 'in_stock' | 'assigned' | 'on_loan' | 'repair' | 'retired' | 'auctioned';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_stock: 'In stock',
  assigned: 'Assigned',
  on_loan: 'On loan',
  repair: 'In repair',
  retired: 'Retired',
  auctioned: 'Auctioned',
};

export const assetStatusLabel = (s: string): string =>
  ASSET_STATUS_LABELS[s as AssetStatus] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
