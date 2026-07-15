import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {type Request, type Response, type NextFunction} from "express";
import { error } from "node:console";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Pass the adapter into Prisma
const prisma = new PrismaClient({ adapter });

export interface AuthenticateRequest extends Request{
    projectId?:string,
    environment?:string
};

export const validateApiKey = async (req:AuthenticateRequest, res:Response, next:NextFunction): Promise<any> => {
    try {
        // grab the api key from the header
        const apiKey = req.headers['x-api-key'] as string;
        if(!apiKey)
            return res.status(401).json({error:'Authentication failed. API Key is missing'});

        // look up the key in postgreSQL
        const foundKey = await prisma.apiKey.findUnique({
            where:{key:apiKey},
            include:{project:true}
        });

        // if the key doesn't exist or been deactivated by the user, block the request
        if(!foundKey || !foundKey.isActive)
            return res.status(403).json({error:'Authentication failed. Invalid or inactive API Key'});

        // stamping the project info right onto the request object
        req.projectId = foundKey.projectId;
        req.environment = foundKey.project.environment;

        next();
    } catch (error) {
        res.status(500).json({error:'Internal server security validation error'});
    }
}