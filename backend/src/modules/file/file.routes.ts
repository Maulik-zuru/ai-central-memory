import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { optionalBucketRole } from '../../shared/bucketAccess';
import { fileController } from './file.controller';
import { SUPPORTED_FILE_MIME_TYPES } from '../../shared/providers/document-parser.provider';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, SUPPORTED_FILE_MIME_TYPES.includes(file.mimetype));
  },
});

export const fileRouter = Router();

fileRouter.use(authenticate);
fileRouter.use(apiRateLimit);

fileRouter.post('/', upload.single('file'), asyncHandler(fileController.upload));
fileRouter.get('/', optionalBucketRole('viewer'), asyncHandler(fileController.list));
fileRouter.post('/search', optionalBucketRole('viewer'), asyncHandler(fileController.search));
fileRouter.get('/:id', asyncHandler(fileController.get));
fileRouter.delete('/:id', asyncHandler(fileController.remove));
fileRouter.post('/:id/ask', asyncHandler(fileController.ask));
