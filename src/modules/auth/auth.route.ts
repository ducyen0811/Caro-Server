import { Router } from "express";
import { login, logout, me, register } from "./auth.controller.js";
import { requireAuth } from "../../middlewares/requireAuth.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);
authRouter.post("/logout", logout);

export default authRouter;