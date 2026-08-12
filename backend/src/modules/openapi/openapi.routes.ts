import { Router, Request, Response } from 'express';
import { buildOpenApiDocument } from './openapi.service';

// Deliberately unauthenticated — the whole point of publishing this (GPT Actions import,
// n8n/Zapier OpenAPI nodes, Postman) is that a client fetches it before it has any credentials
// for this API at all.
export const openApiRouter = Router();

openApiRouter.get('/openapi.json', (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(200).json(buildOpenApiDocument(baseUrl));
});
