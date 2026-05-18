// ... existing code ...

import { SupplyRepository } from '../repositories/SupplyRepository';
import { SupplyService } from './SupplyService';

const supplyRepo = new SupplyRepository();
export const supplyService = new SupplyService(supplyRepo);