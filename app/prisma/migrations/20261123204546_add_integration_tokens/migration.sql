-- CreateTable
CREATE TABLE "integration_tokens" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_prefix" VARCHAR(20) NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_token_hash_key" ON "integration_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "integration_tokens_account_id_user_id_idx" ON "integration_tokens"("account_id", "user_id");

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "domain_users"("account_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
