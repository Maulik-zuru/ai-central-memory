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
memoryRouter.get('/', asyncHandler(memoryController.list));
memoryRouter.get('/:id', asyncHandler(memoryController.get));
memoryRouter.patch('/:id', asyncHandler(memoryController.update));
memoryRouter.patch('/:id/bucket', asyncHandler(memoryController.move));
memoryRouter.delete('/:id', asyncHandler(memoryController.remove));
memoryRouter.get('/:id/versions', asyncHandler(memoryController.listVersions));
