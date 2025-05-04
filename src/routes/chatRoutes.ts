import { Router, RequestHandler } from "express";
import { responseQuery } from "../controller/chatController";

const router = Router();

router.post('/response', responseQuery as RequestHandler)


export default router;