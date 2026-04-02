import { Server } from "socket.io";
import registerMatchSocket from "../modules/match/match.socket.js";

export default function initSocket(io: Server) {
  registerMatchSocket(io);
}