CREATE UNIQUE INDEX "idx_setlists_single_active" ON "setlists" USING btree ("status") WHERE ("status" = 'ACTIVE');
