import { Router } from 'express';
import { SupplyController } from '../controllers/SupplyController';
import { supplyService } from '../services';
import { requireAuth } from '../middleware/auth';

const router = Router();
const controller = new SupplyController(supplyService);

// Plus besoin de .catch(next) ici, le contrôleur s'en occupe déjà !
router.post('/', requireAuth, controller.create);
router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.patch('/:id', requireAuth, controller.update);
router.delete('/:id', requireAuth, controller.delete);

export default router;