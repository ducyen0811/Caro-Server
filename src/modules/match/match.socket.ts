import { Server, Socket } from "socket.io";

type Player = {
  id: string;
  name: string;
  symbol: "X" | "O";
};

type Room = {
  roomCode: string;
  players: Player[];
  board: string[];
  turn: "X" | "O";
  status: string;
  scores: Record<string, number>;
  rematchVotes: string[];
};

const queue: { id: string; name: string }[] = [];
const rooms = new Map<string, Room>();

function emptyBoard(): string[] {
  return Array(225).fill("");
}

function genCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkWin(board: string[]): "X" | "O" | "DRAW" | null {
  const size = 15;
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cur = board[y * size + x];
      if (!cur) continue;

      for (const [dx, dy] of dirs) {
        let count = 1;

        for (let k = 1; k < 5; k++) {
          const nx = x + dx * k;
          const ny = y + dy * k;

          if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
          if (board[ny * size + nx] !== cur) break;

          count++;
        }

        if (count >= 5) {
          return cur as "X" | "O";
        }
      }
    }
  }

  if (board.every(Boolean)) return "DRAW";
  return null;
}

function resetRoom(room: Room) {
  room.board = emptyBoard();
  room.turn = "X";
  room.status = room.players.length < 2 ? "Chờ người chơi" : "Đang chơi";
  room.rematchVotes = [];
}

export default function registerMatchSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    socket.on("player:ready", ({ name }: { name: string }) => {
      socket.data.name = name;
    });

    socket.on("queue:join-random", () => {
      const myName = socket.data.name || "Người chơi";

      const existed = queue.find((p) => p.id === socket.id);
      if (existed) return;

      if (queue.length > 0) {
        const other = queue.shift();
        if (!other) return;

        const code = genCode();

        const players: Player[] = [
          { id: other.id, name: other.name, symbol: "X" },
          { id: socket.id, name: myName, symbol: "O" },
        ];

        const scores: Record<string, number> = {};
        for (const p of players) scores[p.id] = 0;

        const room: Room = {
          roomCode: code,
          players,
          board: emptyBoard(),
          turn: "X",
          status: "Đang chơi",
          scores,
          rematchVotes: [],
        };

        rooms.set(code, room);

        socket.join(code);
        io.sockets.sockets.get(other.id)?.join(code);

        for (const p of players) {
          io.to(p.id).emit("match:found", {
            ...room,
            symbol: p.symbol,
          });
        }
      } else {
        queue.push({
          id: socket.id,
          name: myName,
        });
      }
    });

    socket.on("queue:leave-random", () => {
      const i = queue.findIndex((p) => p.id === socket.id);
      if (i !== -1) queue.splice(i, 1);
    });

    socket.on("room:create-private", () => {
      const code = genCode();

      const player: Player = {
        id: socket.id,
        name: socket.data.name || "Người chơi",
        symbol: "X",
      };

      const room: Room = {
        roomCode: code,
        players: [player],
        board: emptyBoard(),
        turn: "X",
        status: "Chờ người chơi",
        scores: {
          [socket.id]: 0,
        },
        rematchVotes: [],
      };

      rooms.set(code, room);
      socket.join(code);

      socket.emit("room:created", {
        ...room,
        symbol: "X",
      });
    });

    socket.on("room:join-private", ({ roomCode }: { roomCode: string }) => {
      const code = String(roomCode || "").toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        socket.emit("room:error", { message: "Không tồn tại" });
        return;
      }

      if (room.players.length >= 2) {
        socket.emit("room:error", { message: "Phòng đầy" });
        return;
      }

      const player: Player = {
        id: socket.id,
        name: socket.data.name || "Người chơi",
        symbol: "O",
      };

      room.players.push(player);
      room.scores[socket.id] = 0;
      room.status = "Đang chơi";

      socket.join(code);

      for (const p of room.players) {
        io.to(p.id).emit("room:joined", {
          ...room,
          symbol: p.symbol,
        });
      }
    });

    socket.on(
      "game:move",
      ({ roomCode, index }: { roomCode: string; index: number }) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;

        if (room.turn !== player.symbol) return;
        if (index < 0 || index >= room.board.length) return;
        if (room.board[index]) return;

        room.board[index] = player.symbol;
        room.rematchVotes = [];

        const result = checkWin(room.board);

        if (result === "X" || result === "O") {
          const winner = room.players.find((p) => p.symbol === result);
          if (!winner) return;

          room.scores[winner.id] = (room.scores[winner.id] || 0) + 1;
          room.status = `${winner.name} thắng`;
        } else if (result === "DRAW") {
          room.status = "Hòa";
        } else {
          room.turn = room.turn === "X" ? "O" : "X";
        }

        io.to(roomCode).emit("game:update", room);
        io.to(roomCode).emit("score:update", room.scores);
      }
    );

    socket.on("game:rematch-request", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      if (!room.rematchVotes.includes(socket.id)) {
        room.rematchVotes.push(socket.id);
      }

      const opponent = room.players.find((p) => p.id !== socket.id);

      socket.emit("game:rematch-pending", {
        message: "Đang chờ đối thủ đồng ý chơi lại",
      });

      if (opponent) {
        io.to(opponent.id).emit("game:rematch-requested", {
          fromPlayerId: socket.id,
          fromPlayerName: player.name,
          roomCode,
        });
      }

      io.to(roomCode).emit("game:rematch-state", {
        rematchVotes: room.rematchVotes,
      });
    });

    socket.on("game:rematch-accept", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      if (!room.rematchVotes.includes(socket.id)) {
        room.rematchVotes.push(socket.id);
      }

      if (room.players.length === 2 && room.rematchVotes.length >= 2) {
        resetRoom(room);

        io.to(roomCode).emit("game:update", room);
        io.to(roomCode).emit("game:rematch-started", {
          message: "Ván mới bắt đầu",
        });
        io.to(roomCode).emit("game:rematch-state", {
          rematchVotes: room.rematchVotes,
        });
      } else {
        io.to(roomCode).emit("game:rematch-state", {
          rematchVotes: room.rematchVotes,
        });
      }
    });

    socket.on("game:rematch-decline", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      room.rematchVotes = [];

      io.to(roomCode).emit("game:rematch-declined", {
        message: player
          ? `${player.name} đã từ chối chơi lại`
          : "Đối thủ đã từ chối chơi lại",
      });

      io.to(roomCode).emit("game:rematch-state", {
        rematchVotes: room.rematchVotes,
      });
    });

    socket.on("room:leave", ({ roomCode }: { roomCode: string }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      socket.leave(roomCode);
      room.players = room.players.filter((p) => p.id !== socket.id);
      room.rematchVotes = [];

      if (room.players.length === 0) {
        rooms.delete(roomCode);
      } else {
        room.status = "Đối thủ đã rời phòng";
        io.to(roomCode).emit("player:left");
      }
    });

    socket.on("disconnect", () => {
      const i = queue.findIndex((p) => p.id === socket.id);
      if (i !== -1) queue.splice(i, 1);

      for (const [code, room] of rooms.entries()) {
        const exist = room.players.find((p) => p.id === socket.id);
        if (!exist) continue;

        room.players = room.players.filter((p) => p.id !== socket.id);
        room.rematchVotes = [];

        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          room.status = "Đối thủ đã ngắt kết nối";
          io.to(code).emit("player:left");
        }
      }
    });
  });
}