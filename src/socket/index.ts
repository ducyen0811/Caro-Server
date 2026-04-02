import { Server } from "socket.io";
import { registerMatchSocket } from "../modules/match/match.socket.js";

export function initSocket(httpServer: any) {
  const io = new Server(httpServer, {
    cors: {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  credentials: true,
},
  });

  io.use((socket: any, next) => {
    /**
     * Chỗ này đổi theo auth hiện tại của bạn.
     * Tạm thời mình lấy user từ handshake.auth.user
     * FE sẽ truyền:
     * socket.auth = { user: { id, username, email } }
     */
    const user = socket.handshake.auth?.user;

    if (!user?.id) {
      return next(new Error("Unauthorized"));
    }

    socket.data.user = user;
    next();
  });

  io.use((socket: any, next) => {
  const authUser = socket.handshake?.auth?.user;

  const headerUserId = socket.handshake?.headers?.["x-user-id"];
  const headerUsername = socket.handshake?.headers?.["x-username"];
  const headerEmail = socket.handshake?.headers?.["x-email"];

  const queryUserId = socket.handshake?.query?.userId;
  const queryUsername = socket.handshake?.query?.username;
  const queryEmail = socket.handshake?.query?.email;

  const user =
    authUser && authUser.id
      ? authUser
      : headerUserId
      ? {
          id: String(headerUserId),
          username: headerUsername ? String(headerUsername) : undefined,
          email: headerEmail ? String(headerEmail) : undefined,
        }
      : queryUserId
      ? {
          id: String(queryUserId),
          username: queryUsername ? String(queryUsername) : undefined,
          email: queryEmail ? String(queryEmail) : undefined,
        }
      : null;

  if (!user?.id) {
    return next(new Error("Unauthorized"));
  }

  socket.data.user = user;
  next();
});

  return io;
}