import { prisma } from "../../db/client.js";

/** Retain operational delivery metadata for 30 days and cached schedules for 90 days. */
export async function pruneOperationalData(now = new Date()): Promise<{ jobs: number; deliveryLogs: number; schedules: number }> {
  const operationalCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const scheduleCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90));
  const [logs, jobs, schedules] = await prisma.$transaction([
    prisma.notificationDeliveryLog.deleteMany({ where: {
      AND: [
        { OR: [{ deliveredAt: { lt: operationalCutoff } }, { failedAt: { lt: operationalCutoff } }] },
        { OR: [{ jobId: { not: null } }, { failureCode: null }, { failureCode: { notIn: ["50007", "50278", "DM_TEST_OK"] } }] },
      ],
    } }),
    prisma.notificationJob.deleteMany({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, createdAt: { lt: operationalCutoff } } }),
    prisma.prayerSchedule.deleteMany({ where: { localDate: { lt: scheduleCutoff } } }),
  ]);
  return { jobs: jobs.count, deliveryLogs: logs.count, schedules: schedules.count };
}
