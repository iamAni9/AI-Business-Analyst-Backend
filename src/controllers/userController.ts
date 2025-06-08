import { Request, Response } from "express";
import logger from "../config/logger";
import pool from "../config/postgres";
import { v4 as uuidv4 } from 'uuid';
import { SALT_ROUNDS} from "../config/constants";
import bcrypt from "bcryptjs";
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

// const google_client_id = process.env.GOOGLE_CLIENT_ID;
// const google_client_secret = process.env.GOOGLE_CLIENT_SECRET
// const client = new OAuth2Client(google_client_id, google_client_secret, 'postmessage');

const googleAuth = async (req: Request, res: Response) => {
    // const { access_token  } = req.body;
    try {
        
        if (
            !req.body || 
            typeof req.body !== 'object' || 
            !req.body.access_token
        ) {
            logger.error("No access_token provided");
            return res.status(400).json({ 
                success: false, 
                message: "access_token is required" 
            });
        }

        const { access_token } = req.body;

        console.log("Received Google access_token:", access_token);

        // OAuth 2.0 Bearer Token authorization
        let name, email;
        try {
            const userRes = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                },
            });
            ({ name, email } = userRes.data); 
        } catch (err) {
            logger.error("Failed to exchange code for tokens:", err);
            return res.status(401).json({
                success : false,
                message : "Invalid authorization code",
                error : err
            });
        }


        // Finding if user already exists otherwise creating new
        try {
            const { rows } = await pool.query(
                `SELECT * FROM users WHERE email = $1 LIMIT 1`,
                [email]
            );

            let user = rows[0];
            
            if (!user) {
                logger.info("Creating new user for email:", email);
                const id = uuidv4();
                const now = new Date();
                const password = "null_null";
                
                await pool.query(
                    `INSERT INTO users (id, name, email, password, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [id, name, email, password, now, now]
                );
                
                user = { id, name, email };
            }

            req.session.user = { id: user.id, name: user.name, email: user.email };

            // Returning success with user data
            return res.status(200).json({
                success: true,
                message: "Google authentication successful",
                // user: {
                //     id: user.id,
                //     name: user.name,
                //     email: user.email
                // }
            });

        } catch (dbError) {
            logger.error("Database error:", dbError);
            return res.status(500).json({
                success : false,
                message : "Database operation failed",
                error: dbError
            });
        }

    } catch (error: any) {
        logger.error(`Google authentication error: ${error.stack || error.message}`);
        return res.status(500).json({
            success: false,
            message: "Internal server error during Google authentication",
            error: error
            // code: access_token
        });
    }
};

const signInUser = async (req: Request, res: Response) => {
    try {
        if (!req.body || typeof req.body !== 'object' || !req.body.email || !req.body.password) {
            logger.error("Email and password are required");
            return res.status(400).json({ 
                success: false, 
                message: "Email and password are required"
            });
        }
        const { email, password } = req.body;

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
        
        // Password verification
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            logger.error("Invalid password");
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }
        
        req.session.user = { id: user.id, name: user.name, email: user.email };
        return res.status(200).json({
            success: true,
            message: "User signed in successfully",
            // user: {
            //     id: user.id,
            //     name: user.name,
            //     email: user.email
            // }
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
        if (
            !req.body || 
            typeof req.body !== 'object' || 
            !req.body.name || 
            !req.body.email || 
            !req.body.password
        ) {
            logger.error("Name, email and password are required");
            return res.status(400).json({ 
                success: false, 
                message: "Name, email and password are required"
            });
        }

        const { name, email, password } = req.body;

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

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const insertQuery = `
            INSERT INTO users (id, name, email, password, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `
        const { rows } = await pool.query(insertQuery, [id, name, email, hashedPassword, created_at, updated_at]);
        
        logger.info(`User created successfully with id: ${rows[0].id}`)
        req.session.user = { id: id, name: name, email: email };
        return res.status(200).json({
            success: true,
            message: "User created successfully",
            // user: {
            //     id: id,
            //     name: name,
            //     email: email
            // }
        })
        
    } catch (error: any) {
        logger.error(`Sign up error: ${error.message}`)
        res.status(500).json({ 
            success: false,
            message: "Internal server error", 
            error: error
        })
    }
}

const getUserData = async (req: Request, res: Response) => {
    try {
        if (
            !req.body || 
            typeof req.body !== 'object' || 
            !req.body.email
        ) {
            logger.error("email is required");
            return res.status(400).json({ 
                success: false, 
                message: "email is required for finding user"
            });
        }
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
            message: "Internal server error",
            error: error
        })
    }
}

const checkUser = async (req: Request, res: Response) => {
    logger.info('Cookies:', req.cookies);
    logger.info('Session:', req.session);
    try {
         if (!req.session.user) {
            logger.info("Issue in loggin");
            return res.status(401).json({ 
                success: false, 
                message: 'Not logged in' 
            });
        }
        const name = req.session.user.name;
        const email = req.session.user.email;
        res.json({ 
            success: true, 
            message: "User already logged in",
            name: name,
            email: email
        });
    } catch (error: any) {
        logger.error(`Get user data error: ${error.message}`)
        res.status(500).json({ 
            success: false,
            message: "Internal server error",
            error: error
        })
    }
}

const signOutUser = async (req: Request, res: Response) => {
    if (!req.session.user) {
        return res.status(400).json({
            success: false,
            message: "No active session to log out",
        });
    }

    req.session.destroy((err) => {
        if (err) {
            logger.error(`Logout error: ${err.message}`);
            return res.status(500).json({
                success: false,
                message: "Logout failed",
            });
        }

        res.clearCookie('connect.sid'); // change name if you've customized it
        return res.status(200).json({
            success: true,
            message: "User logged out successfully",
        });
    });
}

export { signInUser, signUpUser, getUserData, googleAuth, checkUser, signOutUser }