import { createClient } from 'redis';
import { sendDiscordWebhook } from './alertNotifier.js';

const redisClient = createClient({ url: 'redis://localhost:6379' });
if (!redisClient.isOpen) {
  await redisClient.connect();
}

interface TemporaryAlertRule {
  threshold: number;     // Number of errors allowed before barking
  windowMinutes: number; // Duration of window
  webhookUrl: string;    // Where to ship notifications
}

// If any project encounters more than 5 errors in 1 minute, sound the alarm!
const GLOBAL_ALERT_RULE: TemporaryAlertRule = {
  threshold: 5,
  windowMinutes: 1,
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/YOUR_MOCK_WEBHOOK'
};

export async function checkAlertThreshold(projectId: string, environment: string): Promise<void> {
  const currentMinute = new Date().toISOString().substring(0, 16); // e.g., "2026-03-30T14:25"
  const alertCounterKey = `alerts:count:${projectId}:${currentMinute}`;
  const cooldownKey = `alerts:cooldown:${projectId}`;

  // 1. Increment the specific error tally for this current single minute window
  const currentErrorVolume = await redisClient.incr(alertCounterKey);
  
  // Set expiration on the counter so Redis auto-cleans it after 10 minutes
  if (currentErrorVolume === 1) {
    await redisClient.expire(alertCounterKey, 600);
  }

  // 2. Evaluate rules if the volume crosses the threshold line
  if (currentErrorVolume >= GLOBAL_ALERT_RULE.threshold) {
    
    // Check if we are currently in a cooldown blackout period
    const isCoolingDown = await redisClient.get(cooldownKey);
    
    if (!isCoolingDown) {
      // Set a 5-minute cooldown key so we don't fire an alert on the next incoming error ticket
      await redisClient.set(cooldownKey, 'active', { EX: 300 });

      // 3. Fire out the webhook alert payload!
      await sendDiscordWebhook({
        projectName: 'Production Service', // Fallback name representation
        projectId,
        environment,
        errorCount: currentErrorVolume,
        timeWindowMin: GLOBAL_ALERT_RULE.windowMinutes,
        webhookUrl: GLOBAL_ALERT_RULE.webhookUrl
      });
    }
  }
}