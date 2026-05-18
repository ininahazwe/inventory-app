import { z } from 'zod';

export const CreateSupplySchema = z.object({
    name: z
        .string('Supply name is required')
        .min(1, 'Supply name cannot be empty')
        .max(255, 'Supply name must be <= 255 chars'),

    purchase_date: z
        .string('Purchase date is required')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
        .refine((date) => {
            const d = new Date(date);
            const today = new Date();
            return d <= today;  // Pas de date future
        }, 'Purchase date cannot be in the future'),

    cost: z
        .number('Cost must be a number')
        .positive('Cost must be > 0')
        .multipleOf(0.01, 'Cost must have max 2 decimals'),

    brand: z
        .string()
        .max(100, 'Brand must be <= 100 chars')
        .optional(),

    quantity: z
        .number('Quantity must be a number')
        .int('Quantity must be an integer')
        .gte(1, 'Quantity must be >= 1'),

    receiver_uid: z
        .string('Receiver UID is required')
        .uuid('Receiver UID must be a valid UUID'),
});

export type CreateSupplyDTO = z.infer<typeof CreateSupplySchema>;

export const UpdateSupplySchema = CreateSupplySchema.partial();

export type UpdateSupplyDTO = z.infer<typeof UpdateSupplySchema>;

export const SupplyFilterSchema = z.object({
    receiver_uid: z.string().uuid().optional(),
    brand: z.string().optional(),
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().default(50),
    offset: z.coerce.number().int().default(0),
});

export type SupplyFilterDTO = z.infer<typeof SupplyFilterSchema>;