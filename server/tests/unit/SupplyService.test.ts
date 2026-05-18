import { SupplyService } from '../../src/services/SupplyService';
import { ForbiddenException } from '../../src/exceptions';

describe('SupplyService', () => {
    let service: SupplyService;
    let mockRepo: any;

    beforeEach(() => {
        mockRepo = {
            create: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            getTotalCost: jest.fn(),
            getTotalQuantity: jest.fn(),
        };
        service = new SupplyService(mockRepo);
    });

    describe('createSupply', () => {
        it('should throw if user is not accountant', async () => {
            const dto = {
                name: 'Test',
                purchase_date: '2026-05-18',
                cost: 10,
                quantity: 1,
                receiver_uid: 'uuid-123',
            };

            await expect(
                service.createSupply(dto, 'user-uid', 'user')
            ).rejects.toThrow(ForbiddenException);
        });

        it('should create if accountant', async () => {
            mockRepo.create.mockResolvedValue({
                id: 1,
                name: 'Test',
                purchase_date: '2026-05-18',
                cost: 10,
                quantity: 1,
                receiver_uid: 'uuid-123',
                created_by_uid: 'user-uid',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });

            const result = await service.createSupply(
                { name: 'Test', purchase_date: '2026-05-18', cost: 10, quantity: 1, receiver_uid: 'uuid-123' },
                'user-uid',
                'accountant'
            );

            expect(result.id).toBe(1);
        });
    });
});