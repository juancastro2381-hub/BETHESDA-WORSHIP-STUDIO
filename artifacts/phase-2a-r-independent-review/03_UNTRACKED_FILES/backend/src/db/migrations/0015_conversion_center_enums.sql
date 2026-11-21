-- Migration 0015: Conversion Center Enums (CONVERSION job type & REVIEW_REQUIRED status)
-- Bethesda Worship Studio - Phase 2A-R

ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'CONVERSION';
ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

