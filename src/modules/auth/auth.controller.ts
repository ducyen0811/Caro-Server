import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { comparePassword, hashPassword } from "../../lib/password.js";
import { signAccessToken } from "../../lib/jwt.js";
import type { AuthRequest } from "../../middlewares/requireAuth.js";

function formatUser(user: {
  id: string;
  username: string;
  email: string;
  stats?: { eloRating: number } | null;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    elo: user.stats?.eloRating ?? 1000,
  };
}

export async function register(req: Request, res: Response) {
  try {
    const username = String(req.body.username ?? "").trim();
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");

    if (!username || !email || !password) {
      return res.status(400).json({
        message: "Vui lòng nhập đầy đủ username, email, password",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Mật khẩu phải có ít nhất 6 ký tự",
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Username hoặc email đã tồn tại",
      });
    }

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          passwordHash,
        },
      });

      const stats = await tx.userStats.create({
        data: {
          userId: user.id,
          eloRating: 1000,
        },
      });

      return { user, stats };
    });

    const accessToken = signAccessToken({
      userId: result.user.id,
      username: result.user.username,
      email: result.user.email,
    });

    return res.status(201).json({
      message: "Đăng ký thành công",
      accessToken,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        elo: result.stats.eloRating,
      },
    });
  } catch (error) {
    console.error("register error:", error);
    return res.status(500).json({
      message: "Lỗi server khi đăng ký",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");

    if (!email || !password) {
      return res.status(400).json({
        message: "Vui lòng nhập email và mật khẩu",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        stats: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    const isMatch = await comparePassword(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    return res.json({
      message: "Đăng nhập thành công",
      accessToken,
      user: formatUser(user),
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({
      message: "Lỗi server khi đăng nhập",
    });
  }
}

export async function me(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        stats: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "Không tìm thấy người dùng",
      });
    }

    return res.json({
      user: formatUser(user),
    });
  } catch (error) {
    console.error("me error:", error);
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
}

export async function logout(_req: Request, res: Response) {
  return res.json({
    message: "Đăng xuất thành công",
  });
}