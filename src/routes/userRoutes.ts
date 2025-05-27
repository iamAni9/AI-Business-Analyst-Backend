import { Router, RequestHandler } from "express";
import { signInUser, signUpUser, getUserData, googleAuth, checkUser, signOutUser } from "../controllers/userController";

const router = Router()

router.post("/sign-in", signInUser as RequestHandler)
router.post("/sign-up", signUpUser as RequestHandler)
router.post("/get-user-data", getUserData as RequestHandler)
router.post("/auth/google", googleAuth as unknown as RequestHandler);
router.get("/check-user", checkUser as unknown as RequestHandler);
router.post("/log-out", signOutUser as unknown as RequestHandler);


export default router