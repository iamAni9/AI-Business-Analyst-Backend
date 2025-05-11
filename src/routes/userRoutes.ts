import { Router, RequestHandler } from "express";
import { signInUser, signUpUser, getUserData } from "../controllers/userController";

const router = Router()


router.post("/sign-in", signInUser as RequestHandler)
router.post("/sign-up", signUpUser as RequestHandler)
router.post("/get-user-data", getUserData as RequestHandler)



export default router