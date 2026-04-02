/*
  Warnings:

  - A unique constraint covering the columns `[roomId]` on the table `Match` will be added. If there are existing duplicate values, this will fail.
  - The required column `roomId` was added to the `Match` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "currentTurn" "PlayerRole" NOT NULL DEFAULT 'X',
ADD COLUMN     "roomId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Match_roomId_key" ON "Match"("roomId");
