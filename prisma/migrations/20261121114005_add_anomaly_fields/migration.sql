-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "anomalyReasons" TEXT[],
ADD COLUMN     "reviewedAt" TIMESTAMP(3);
