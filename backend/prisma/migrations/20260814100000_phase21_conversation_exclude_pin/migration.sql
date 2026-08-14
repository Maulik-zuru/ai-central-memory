-- Phase 21 (MemoryPlugin_Clone_Spec.md §3.3): Conversation gains excludedAt/pinned. Both are
-- additive and safely defaulted, so no backfill is needed for existing rows.
ALTER TABLE "Conversation" ADD COLUMN "excludedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
