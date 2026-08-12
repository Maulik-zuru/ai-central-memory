import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { memoryController } from './memory.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

export const memoryRouter = Router();

memoryRouter.use(authenticate);
memoryRouter.use(apiRateLimit);
memoryRouter.post('/', asyncHandler(memoryController.create));
memoryRouter.post('/one-click', asyncHandler(memoryController.oneClickSave));
memoryRouter.post('/image', upload.single('image'), asyncHandler(memoryController.createImage));
memoryRouter.post('/merge', asyncHandler(memoryController.merge));
memoryRouter.post('/bulk-delete', asyncHandler(memoryController.bulkDelete));
memoryRouter.get('/', asyncHandler(memoryController.list));
memoryRouter.get('/search', asyncHandler(memoryController.search));
memoryRouter.get('/:id', asyncHandler(memoryController.get));
memoryRouter.patch('/:id', asyncHandler(memoryController.update));
memoryRouter.patch('/:id/bucket', asyncHandler(memoryController.move));
memoryRouter.delete('/:id', asyncHandler(memoryController.remove));
memoryRouter.get('/:id/versions', asyncHandler(memoryController.listVersions));

// Phase 15 (US-INT-06): the versioned public surface, mounted separately at /api/v2/memory
// (MemoryPlugin_Clone_Spec.md §6) rather than nested under /api/memories — a distinct top-level
// prefix is what "versioned" means here, not a sub-path of the v1 router.
export const memoryV2Router = Router();
memoryV2Router.use(authenticate);
memoryV2Router.use(apiRateLimit);
memoryV2Router.get('/', asyncHandler(memoryController.v2Query));
memoryV2Router.post('/update', asyncHandler(memoryController.v2Update));
