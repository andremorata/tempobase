-- CreateIndex
CREATE UNIQUE INDEX "domain_users_email_active_key" ON "domain_users"("email") WHERE (is_deleted = false);

