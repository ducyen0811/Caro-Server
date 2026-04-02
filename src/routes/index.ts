import { Router } from "express";
import authRouter from "../modules/auth/auth.route.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Caro server is running",
    time: new Date().toISOString(),
  });
});

router.use("/auth", authRouter);

export default router;