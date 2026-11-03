import type { Client } from "discord.js";
import { logger } from "../../shared/logger.js";
import { materializeAllNotifications } from "./scheduler.js";
import { processDueNotifications, recoverNotificationJobs } from "./worker.js";
import { prisma } from "../../db/client.js";
import { finalizePreviousPrayerDay } from "../prayer-tracking/service.js";
import { publishAllCommunities } from "../community/publisher.js";
import { pruneOperationalData } from "./retention.js";

export function startNotificationRuntime(client: Client): () => Promise<void> {
  let stopped = false;
  let scheduling = false;
  let processing = false;
  let finalizing = false;
  let publishing = false;
  let lastLeaseRecovery = 0;
  let maintenance = false;
  const activeTasks = new Set<Promise<void>>();
  const track = (task: Promise<void>): void => {
    activeTasks.add(task);
    void task.finally(() => activeTasks.delete(task));
  };

  const runSchedule = async (): Promise<void> => {
    if (stopped || scheduling) return;
    scheduling = true;
    try { await materializeAllNotifications(); }
    catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Reminder schedule refresh failed"); }
    finally { scheduling = false; }
  };
  const runWorker = async (): Promise<void> => {
    if (stopped || processing) return;
    processing = true;
    try {
      if (Date.now() - lastLeaseRecovery >= 30_000) {
        const count = await recoverNotificationJobs();
        lastLeaseRecovery = Date.now();
        if (count) logger.warn({ count }, "Failed expired notification jobs to prevent duplicate sends");
      }
      await processDueNotifications(client);
    }
    catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Reminder queue polling failed"); }
    finally { processing = false; }
  };
  const runFinalizer = async (): Promise<void> => {
    if (stopped || finalizing) return;
    finalizing = true;
    try {
      const users = await prisma.user.findMany({ where: { timezone: { not: null } }, select: { discordId: true } });
      for (const user of users) {
        try { await finalizePreviousPrayerDay(user.discordId); }
        catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Prayer-day finalization failed"); }
      }
    } catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Prayer-day finalization scan failed"); }
    finally { finalizing = false; }
  };
  const runPublisher = async (): Promise<void> => {
    if (stopped || publishing) return;
    publishing = true;
    try { await publishAllCommunities(client); }
    catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Community update scan failed"); }
    finally { publishing = false; }
  };
  const runMaintenance = async (): Promise<void> => {
    if (stopped || maintenance) return;
    maintenance = true;
    try {
      const counts = await pruneOperationalData();
      if (counts.jobs + counts.deliveryLogs + counts.schedules > 0) logger.info(counts, "Pruned expired operational notification data");
    } catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Operational data retention cleanup failed"); }
    finally { maintenance = false; }
  };

  track(recoverNotificationJobs().then((count) => {
    if (count) logger.warn({ count }, "Marked expired notification worker leases as failed to prevent duplicate sends");
  }).catch((error: unknown) => logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Notification recovery check failed")));
  track(runSchedule());
  track(runWorker());
  track(runFinalizer());
  track(runPublisher());
  track(runMaintenance());
  const schedulerTimer = setInterval(() => track(runSchedule()), 5 * 60_000);
  const workerTimer = setInterval(() => track(runWorker()), 5_000);
  const finalizerTimer = setInterval(() => track(runFinalizer()), 5 * 60_000);
  const publisherTimer = setInterval(() => track(runPublisher()), 15 * 60_000);
  const maintenanceTimer = setInterval(() => track(runMaintenance()), 24 * 60 * 60_000);
  return async () => {
    stopped = true;
    clearInterval(schedulerTimer);
    clearInterval(workerTimer);
    clearInterval(finalizerTimer);
    clearInterval(publisherTimer);
    clearInterval(maintenanceTimer);
    await Promise.allSettled([...activeTasks]);
  };
}
