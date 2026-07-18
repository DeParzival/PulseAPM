/*
  Warnings:

  - You are about to drop the column `timestamp` on the `MetricSummary` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[projectId,timeStamp]` on the table `MetricSummary` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `timeStamp` to the `MetricSummary` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "MetricSummary_projectId_timestamp_key";

-- AlterTable
ALTER TABLE "MetricSummary" DROP COLUMN "timestamp",
ADD COLUMN     "timeStamp" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MetricSummary_projectId_timeStamp_key" ON "MetricSummary"("projectId", "timeStamp");
