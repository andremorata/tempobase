-- CreateTable
CREATE TABLE "integration_operations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "result_entry_id" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,

    CONSTRAINT "integration_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_operations_account_id_user_id_idx" ON "integration_operations"("account_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_operations_token_id_idempotency_key_key" ON "integration_operations"("token_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "domain_users"("account_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "integration_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_result_entry_id_fkey" FOREIGN KEY ("result_entry_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
