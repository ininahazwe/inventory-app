import type {Request, Response} from 'express';
import { SupplyService } from '../services/SupplyService';
import { CreateSupplySchema, UpdateSupplySchema, SupplyFilterSchema } from '../schemas/SupplySchemas';
import { asyncHandler } from '../middleware/errorHandler';
import type {AuthUser} from '../types/requests';

export class SupplyController {
    supplyService: SupplyService;

    constructor(supplyService: SupplyService) {
        this.supplyService = supplyService;
    }

    create = asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as AuthUser;
        const dto = CreateSupplySchema.parse(req.body);
        const supply = await this.supplyService.createSupply(dto, String(user.uid), user.role);
        res.status(201).json(supply);
    });

    list = asyncHandler(async (req: Request, res: Response) => {
        const filters = SupplyFilterSchema.parse(req.query);
        const result = await this.supplyService.listSupplies(filters);
        res.json(result);
    });

    getById = asyncHandler(async (req: Request, res: Response) => {
        const id = parseInt(req.params.id as string);
        const supply = await this.supplyService.getSupply(id);
        res.json(supply);
    });

    update = asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as AuthUser;
        const id = parseInt(req.params.id as string);
        const dto = UpdateSupplySchema.parse(req.body);
        const supply = await this.supplyService.updateSupply(id, dto, String(user.uid), user.role);
        res.json(supply);
    });

    delete = asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as AuthUser;
        const id = parseInt(req.params.id as string);
        await this.supplyService.deleteSupply(id, String(user.uid), user.role);
        res.json({ message: 'Supply deleted' });
    });
}