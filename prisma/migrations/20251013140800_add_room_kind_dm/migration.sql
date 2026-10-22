-- CreateEnum
CREATE TYPE "RoomKind" AS ENUM ('direct', 'group');

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "kind" "RoomKind" NOT NULL DEFAULT 'group';
ALTER TABLE "Room" ADD COLUMN "dmKey" TEXT;
ALTER TABLE "Room" ADD COLUMN "createdById" TEXT;

-- Default agentName: '' (chỉ ảnh hưởng row mới)
ALTER TABLE "Room" ALTER COLUMN "agentName" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Room_dmKey_key" ON "Room"("dmKey");

-- CreateIndex
CREATE INDEX "Room_kind_idx" ON "Room"("kind");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;