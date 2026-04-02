import http from "http";
import app from "./app.js";
import { Server } from "socket.io";
import initSocket from "./socket/index.js";

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

initSocket(io);

server.listen(4000, () => {
  console.log("Server running at 4000");
});