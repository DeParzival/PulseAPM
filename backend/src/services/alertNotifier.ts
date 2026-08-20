import axios from "axios";

interface AlertPayload{
    projectName:string,
    projectId:string,
    environment:string,
    errorCount:number,
    timeWindowMin:number,
    webhookUrl:string
}

export async function sendDiscordWebhook(payload: AlertPayload): Promise<void> {
    try {
        const discordMessage = {
        username: 'Pulse APM Guardian',
        avatar_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100', // Placehold avatar
        embeds: [
            {
            title: '🚨 CRITICAL: Error Threshold Exceeded!',
            description: `Project **${payload.projectName}** is experiencing a sudden surge in crashes.`,
            color: 15158332, // Crimson Red
            fields: [
                { name: 'Project ID', value: `\`${payload.projectId}\``, inline: true },
                { name: 'Environment', value: `\`${payload.environment.toUpperCase()}\``, inline: true },
                { name: 'Trigger Event', value: `Crossed **${payload.errorCount} errors** in under ${payload.timeWindowMin} minute(s).`, inline: false }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'Pulse APM Real-Time Protection' }
            }
        ]
        };

        await axios.post(payload.webhookUrl, discordMessage);
        console.log(`Alert webhook safely deployed to Discord for project: ${payload.projectId}`);

    } catch (error) {
        console.error(`Failed to deliver Discord webhook alert for ${payload.projectId}:`, error);
    }
}