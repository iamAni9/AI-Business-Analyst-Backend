import { Request, Response } from "express";
import logger from "../config/logger";
import pool from "../config/postgres";
import { v4 as uuidv4 } from 'uuid';

const signInUser = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            logger.error("Email and password are required")
            return res.status(400).json({ 
                success: false, 
                message: "Email and password are required"
            })
        }

        const query = `
            SELECT *
            FROM users
            WHERE email = $1
            LIMIT 1
        `
        const { rows } = await pool.query(query, [email]);

        if (!rows || rows.length === 0) {
            logger.error("User not found")
            return res.status(401).json({ 
                success: false, 
                message: "Email is not registered"
            })
        }
        
        const user = rows[0];
        
        // Here you should add password verification
        // For example:
        // const isPasswordValid = await comparePassword(password, user.password);
        // if (!isPasswordValid) {
        //     logger.error("Invalid password")
        //     return res.status(401).json({
        //         success: false,
        //         message: "Invalid email or password"
        //     })
        // }
        
        return res.status(200).json({
            success: true,
            message: "User signed in successfully",
            user: {
                id: user.id,
                email: user.email,
                // Include other user properties as needed, but exclude sensitive data
            }
        })
    } catch (error: any) {
        logger.error(`Sign in error: ${error.message}`)
        res.status(500).json({ 
            success: false,
            message: "Internal server error" 
        })
    }
}

const signUpUser = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            logger.error("Email and password are required")
            return res.status(400).json({ 
                success: false, 
                message: "Email and password are required"
            })
        }

        // Check if user exists
        const checkQuery = `
            SELECT *
            FROM users
            WHERE email = $1
            LIMIT 1
        `
        const { rows: existingUsers } = await pool.query(checkQuery, [email]);
        
        if (existingUsers && existingUsers.length > 0) {
            logger.error("User already exists")
            return res.status(400).json({ 
                success: false, 
                message: "User already exists"
            })
        }

        const id = uuidv4();
        const created_at = new Date();
        const updated_at = created_at;

        const insertQuery = `
            INSERT INTO users (id, email, password, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `
        const { rows } = await pool.query(insertQuery, [id, email, password, created_at, updated_at]);
        
        logger.info(`User created successfully with id: ${rows[0].id}`)
        return res.status(200).json({
            success: true,
            message: "User created successfully"
        })
        
    } catch (error: any) {
        logger.error(`Sign up error: ${error.message}`)
        res.status(500).json({ 
            success: false,
            message: "Internal server error" 
        })
    }
}

const getUserData = async (req: Request, res: Response) => {
    try {
        const { email } = req.body
        const query = `
            SELECT *
            FROM users_data
            WHERE email = $1
            LIMIT 1
        `
        const { rows } = await pool.query(query, [email]);
        if (!rows || rows.length === 0) {
            logger.error("User not found")
            return res.status(401).json({ 
                success: false, 
                message: "User not found"
            })
        }
        const user = rows[0];
        return res.status(200).json({
            success: true,
            message: "User data fetched successfully",
            user: user
        })
    } catch (error: any) {
        logger.error(`Get user data error: ${error.message}`)
        res.status(500).json({ 
            success: false,
            message: "Internal server error" 
        })
    }
}

export { signInUser, signUpUser, getUserData }