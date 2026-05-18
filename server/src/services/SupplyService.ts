import { SupplyRepository } from '../repositories/SupplyRepository';
import type {CreateSupplyDTO, UpdateSupplyDTO, SupplyFilterDTO} from '../schemas/SupplySchemas';
import type {Supply, SupplyListResponse} from '../entities/Supply';
import { NotFoundException, ForbiddenException, BusinessException } from '../exceptions';
import { logger } from '../middleware/logger';

export class SupplyService {
    supplyRepo: SupplyRepository;

    constructor(supplyRepo: SupplyRepository) {
        this.supplyRepo = supplyRepo;
    }

    async createSupply(dto: CreateSupplyDTO, userUid: string, userRole: string): Promise<Supply> {
        // Permission
        if (!['accountant', 'super_admin'].includes(userRole)) {
            throw new ForbiddenException('Only accountants can create supplies');
        }

        try {
            const supply = await this.supplyRepo.create(dto, userUid);
            logger.info(`[SUPPLY_CREATED] ID #${supply.id} by user ${userUid}`);
            return supply;
        } catch (error) {
            logger.error('[SUPPLY_CREATE_SERVICE_ERROR]', error);
            throw new BusinessException('Failed to create supply');
        }
    }

    async getSupply(id: number): Promise<Supply> {
        const supply = await this.supplyRepo.findById(id);
        if (!supply) throw new NotFoundException(`Supply #${id} not found`);
        return supply;
    }

    async listSupplies(filters: SupplyFilterDTO): Promise<SupplyListResponse> {
        const supplies = await this.supplyRepo.findAll({
            receiver_uid: filters.receiver_uid,
            brand: filters.brand,
            from_date: filters.from_date,
            to_date: filters.to_date,
            limit: filters.limit,
            offset: filters.offset,
        });

        const totalCost = await this.supplyRepo.getTotalCost({
            receiver_uid: filters.receiver_uid,
            brand: filters.brand,
            from_date: filters.from_date,
            to_date: filters.to_date,
        });

        const totalQuantity = await this.supplyRepo.getTotalQuantity({
            receiver_uid: filters.receiver_uid,
            brand: filters.brand,
            from_date: filters.from_date,
            to_date: filters.to_date,
        });

        return { supplies, totalCost, totalQuantity, totalItems: supplies.length };
    }

    async updateSupply(id: number, dto: UpdateSupplyDTO, userUid: string, userRole: string): Promise<Supply> {
        if (!['accountant', 'super_admin'].includes(userRole)) {
            throw new ForbiddenException('Only accountants can edit supplies');
        }

        const existing = await this.supplyRepo.findById(id);
        if (!existing) throw new NotFoundException(`Supply #${id} not found`);

        try {
            await this.supplyRepo.update(id, dto);
            const updated = await this.supplyRepo.findById(id);
            logger.info(`[SUPPLY_UPDATED] ID #${id} by user ${userUid}`);
            return updated!;
        } catch (error) {
            logger.error('[SUPPLY_UPDATE_SERVICE_ERROR]', error);
            throw new BusinessException('Failed to update supply');
        }
    }

    async deleteSupply(id: number, userUid: string, userRole: string): Promise<void> {
        if (userRole !== 'super_admin') {
            throw new ForbiddenException('Only super_admin can delete supplies');
        }

        const existing = await this.supplyRepo.findById(id);
        if (!existing) throw new NotFoundException(`Supply #${id} not found`);

        try {
            await this.supplyRepo.delete(id);
            logger.info(`[SUPPLY_DELETED] ID #${id} by user ${userUid}`);
        } catch (error) {
            logger.error('[SUPPLY_DELETE_SERVICE_ERROR]', error);
            throw new BusinessException('Failed to delete supply');
        }
    }
}