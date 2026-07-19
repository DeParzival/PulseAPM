import {type Response, type NextFunction} from "express";
import { createClient } from "redis";
import type { AuthenticateRequest } from "./validateKey.js";
import { error } from "node:console";

const redisClient = createClient({url: 'redis://localhost:6379'});
redisClient.connect().catch(console.error);

// Maximum of 60 requests per minute per project
const WINDOW_SIZE_IN_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 60;

export const rateLimiter = async (req: AuthenticateRequest, res: Response, next: NextFunction): Promise<any> => {
    const projectId = req.projectId;
    if(!projectId)
        return res.status(500).json({error:'Rate limiting failed. Project context missing'});

    // Create a unique Redis scoreboard key specific to this project
    const redisKey = `rate_limit:${projectId}`;

    try {
        const requestMade = await redisClient.incr(redisKey);

        // If this is the very first request in this cycle, set an expiration countdown
        if(requestMade===1)
            await redisClient.expire(redisKey, WINDOW_SIZE_IN_SECONDS);

        if(requestMade>MAX_REQUESTS_PER_WINDOW)
            return res.status(429).json({
                error:'Too many requests. Your API key rate limit has been exceeded. Please slow down.'
        });

        next();
    } catch (error) {
        next();
    }
}