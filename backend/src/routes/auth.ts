import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from "bcryptjs";
import {Router, type Request, type Response} from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { isUint8ClampedArray } from "util/types";

const router=Router();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Pass the adapter into Prisma
const prisma = new PrismaClient({ adapter });
const JWT_SECRET=process.env.JWT_SECRET || 'fallback_secret'


// User Registration
router.post('/register', async (req:Request, res:Response): Promise<any> => {
    try {
        const {email, password} = req.body;

        // check if user already exist
        const existingUser = await prisma.user.findUnique({where:{email}});
        if(existingUser)
            return res.status(400).json({error:'Email already registered'});

        // scrambling the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save new user to the database
        const newUser = await prisma.user.create({
            data:{email, password:hashedPassword}
        });

        res.status(201).json({message:'User created successfully', userId:newUser.id});

    } catch (error) {
        res.status(500).json({error:'Registration failed'});
    }
});

// User login
router.post('/login', async (req:Request, res:Response): Promise<any> => {
    try {
        const {email, password} = req.body;

        const user = await prisma.user.findUnique({where:{email}});
        if(!user)
            return res.status(400).json({error:'Invalid email or password'});

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if(!isPasswordValid)
            return res.status(400).json({error:'Invalid email or password'});

        // Issue a secure JWT token containing the userId, valid for 24 hours
        const token = jwt.sign({userId:user.id}, JWT_SECRET, {expiresIn: '24h'});
        
        res.json({message:'Login successful', token});

    } catch (error) {
        res.status(500).json({error:'Login failed'})
    }
});

// PROJECT & API KEY CREATION
router.post('/projects', async (req:Request, res:Response): Promise<any> => {
    try {
        const {name, environment, token} = req.body;

        // verify user
        const decoded = jwt.verify(token, JWT_SECRET) as {userId:string};

        // generate an api-key string
        const generatedKey = `pulse_${crypto.randomBytes(16).toString('hex')}`;

        const newProject = await prisma.project.create({
            data:{
                name,
                environment: environment || 'production',
                userId: decoded.userId,
                apiKeys:{
                    create:{
                        key:generatedKey,
                        name:'Default Development Key'
                    }
                }
            },
            include: {apiKeys:true}
        });

        res.status(201).json({
            message:'Project created successfully',
            projectId: newProject.id,
            apiKey: newProject?.apiKeys[0]?.key
        });

    } catch (error) {
        res.status(401).json({error:'Unauthorized or invalid token'});
    }
})

export default router;