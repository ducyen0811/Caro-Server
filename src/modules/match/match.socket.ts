import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import { prisma } from "../../lib/prisma.js";
import { matchRuntimeState } from "./match.state.js";
import {
  buildBoardFromMoves,
  checkWinFromLastMove,
  getOppositeRole,
  isBoardFull,
  isInsideBoard,
  type MoveWithRole,
  type Role,
} from "./match.utils.js";

type QueueType = "RANKED" | "CASUAL";

type SocketUser = {
  id: string;
  username?: string;
  email?: string;
};

type AuthedSocket = Socket & {
  data: {
    user?: SocketUser;
  };
};

type WinningCell = {
  x: number;
  y: number;
};

type DbPlayerUser = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

type DbMatchPlayer = {
  id: string;
  userId: string;
  role: Role;
  result: string | null;
  joinedAt?: Date;
  user: DbPlayerUser;
};

type DbMovePlayer = {
  id: string;
  userId: string;
  role: Role;
};

type DbMove = {
  id: string;
  moveNumber: number;
  x: number;
  y: number;
  createdAt: Date;
  player: DbMovePlayer;
};

type DbMatchStateRecord = {
  id: string;
  roomId: string;
  status: string;
  boardSize: number;
  winLength: number;
  currentTurn: Role;
  winnerId: string | null;
  endedType: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  players: DbMatchPlayer[];
  moves: DbMove[];
};

type DbLiveMatchRecord = {
  id: string;
  roomId: string;
  status: string;
  boardSize: number;
  winLength: number;
  currentTurn: Role;
  winnerId: string | null;
  endedType: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  players: Array<{
    id: string;
    userId: string;
    role: Role;
    result: string | null;
    user: DbPlayerUser;
  }>;
  moves: DbMove[];
};

type DbSurrenderMatchRecord = {
  id: string;
  roomId: string;
  status: string;
  players: Array<{
    id: string;
    userId: string;
    role: Role;
    result: string | null;
  }>;
};

type MatchStatePlayer = {
  matchPlayerId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  role: Role;
  result: string | null;
};

type MatchStateMove = {
  id: string;
  moveNumber: number;
  x: number;
  y: number;
  userId: string;
  role: Role;
  createdAt: Date;
};

type MatchState = {
  matchId: string;
  roomId: string;
  status: string;
  boardSize: number;
  winLength: number;
  currentTurn: Role;
  winnerId: string | null;
  endedType: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  board: Array<Array<Role | null>>;
  winningCells: WinningCell[];
  players: MatchStatePlayer[];
  moves: MatchStateMove[];
};

function isIntegerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "code" in error && (error as { code?: unknown }).code === code;
}

function normalizeQueueType(value: unknown): QueueType {
  return value === "RANKED" ? "RANKED" : "CASUAL";
}

function normalizeBoardSize(value: unknown): number {
  if (!isIntegerNumber(value)) return 15;
  if (value < 5) return 15;
  return value;
}

function getRandomRoles(userAId: string, userBId: string) {
  const xUserId = Math.random() < 0.5 ? userAId : userBId;
  const oUserId = xUserId === userAId ? userBId : userAId;

  return { xUserId, oUserId };
}

async function ensureUserStats(userId: string) {
  await prisma.userStats.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      eloRating: 1000,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    },
  });
}

async function updateStatsAfterWin(winnerUserId: string, loserUserId: string) {
  const now = new Date();

  await prisma.$transaction([
    prisma.userStats.upsert({
      where: { userId: winnerUserId },
      update: {
        gamesPlayed: { increment: 1 },
        wins: { increment: 1 },
        lastMatchAt: now,
      },
      create: {
        userId: winnerUserId,
        eloRating: 1000,
        gamesPlayed: 1,
        wins: 1,
        losses: 0,
        draws: 0,
        lastMatchAt: now,
      },
    }),
    prisma.userStats.upsert({
      where: { userId: loserUserId },
      update: {
        gamesPlayed: { increment: 1 },
        losses: { increment: 1 },
        lastMatchAt: now,
      },
      create: {
        userId: loserUserId,
        eloRating: 1000,
        gamesPlayed: 1,
        wins: 0,
        losses: 1,
        draws: 0,
        lastMatchAt: now,
      },
    }),
  ]);
}

async function updateStatsAfterDraw(userIds: string[]) {
  const now = new Date();

  await prisma.$transaction(
    userIds.map((userId) =>
      prisma.userStats.upsert({
        where: { userId },
        update: {
          gamesPlayed: { increment: 1 },
          draws: { increment: 1 },
          lastMatchAt: now,
        },
        create: {
          userId,
          eloRating: 1000,
          gamesPlayed: 1,
          wins: 0,
          losses: 0,
          draws: 1,
          lastMatchAt: now,
        },
      })
    )
  );
}

async function getMatchState(matchId: string): Promise<MatchState | null> {
  const rawMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: {
        orderBy: { joinedAt: "asc" },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
      moves: {
        orderBy: { moveNumber: "asc" },
        include: {
          player: {
            select: {
              id: true,
              userId: true,
              role: true,
            },
          },
        },
      },
    },
  });

  const match = rawMatch as unknown as DbMatchStateRecord | null;

  if (!match) return null;

  const moves = match.moves as unknown as MoveWithRole[];
  const board = buildBoardFromMoves(moves, match.boardSize);

  let winningCells: WinningCell[] = [];

  const lastMove: MoveWithRole | null =
    moves.length > 0 ? (moves[moves.length - 1] as MoveWithRole) : null;

  if (match.status === "FINISHED" && match.endedType === "WIN" && lastMove) {
    const result = checkWinFromLastMove(
      board,
      lastMove.x,
      lastMove.y,
      lastMove.player.role as Role,
      match.winLength
    );

    winningCells = result.cells;
  }

  return {
    matchId: match.id,
    roomId: match.roomId,
    status: match.status,
    boardSize: match.boardSize,
    winLength: match.winLength,
    currentTurn: match.currentTurn,
    winnerId: match.winnerId,
    endedType: match.endedType,
    createdAt: match.createdAt,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    board,
    winningCells,
    players: match.players.map((player) => ({
      matchPlayerId: player.id,
      userId: player.userId,
      username: player.user.username,
      avatarUrl: player.user.avatarUrl,
      role: player.role,
      result: player.result,
    })),
    moves: moves.map((move) => ({
      id: move.id,
      moveNumber: move.moveNumber,
      x: move.x,
      y: move.y,
      userId: move.player.userId,
      role: move.player.role as Role,
      createdAt: move.createdAt,
    })),
  };
}

export function registerMatchSocket(io: Server, socket: AuthedSocket) {
  const currentUser = socket.data.user;

  if (currentUser?.id) {
    matchRuntimeState.setUserSocket(currentUser.id, socket.id);
  }

  socket.on(
    "matchmaking:join",
    async (payload?: { queueType?: QueueType; boardSize?: number }) => {
      try {
        const user = socket.data.user;

        if (!user?.id) {
          socket.emit("matchmaking:error", { message: "Unauthorized" });
          return;
        }

        const queueType = normalizeQueueType(payload?.queueType);
        const boardSize = normalizeBoardSize(payload?.boardSize);

        await ensureUserStats(user.id);

        const stats = await prisma.userStats.findUnique({
          where: { userId: user.id },
        });

        const ratingSnapshot = stats?.eloRating ?? 1000;

        const existingSearching = await prisma.matchmakingQueue.findUnique({
          where: { userId: user.id },
        });

        if (existingSearching?.status === "SEARCHING") {
          socket.emit("matchmaking:searching", {
            message: "Bạn đang trong hàng chờ",
            expiresIn: 15,
          });
          return;
        }

        const opponentEntry = await prisma.matchmakingQueue.findFirst({
          where: {
            status: "SEARCHING",
            queueType,
            boardSize,
            userId: { not: user.id },
          },
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        });

        if (!opponentEntry) {
          await prisma.matchmakingQueue.upsert({
            where: { userId: user.id },
            update: {
              queueType,
              boardSize,
              ratingSnapshot,
              status: "SEARCHING",
            },
            create: {
              userId: user.id,
              queueType,
              boardSize,
              ratingSnapshot,
              status: "SEARCHING",
            },
          });

          matchRuntimeState.setSearchTimeout(
            user.id,
            setTimeout(async () => {
              try {
                const deleted = await prisma.matchmakingQueue.deleteMany({
                  where: {
                    userId: user.id,
                    status: "SEARCHING",
                  },
                });

                if (deleted.count > 0) {
                  const latestSocketId = matchRuntimeState.getSocketId(user.id);

                  if (latestSocketId) {
                    io.to(latestSocketId).emit("matchmaking:timeout", {
                      message: "Hết 15 giây, chưa tìm thấy đối thủ",
                    });
                  }
                }
              } finally {
                matchRuntimeState.clearSearchTimeout(user.id);
              }
            }, 15000)
          );

          socket.emit("matchmaking:searching", {
            message: "Đang tìm đối thủ...",
            expiresIn: 15,
          });

          return;
        }

        matchRuntimeState.clearSearchTimeout(user.id);
        matchRuntimeState.clearSearchTimeout(opponentEntry.userId);

        const { xUserId, oUserId } = getRandomRoles(user.id, opponentEntry.userId);
        const roomId = `room_${randomUUID()}`;

        const createdMatch = await prisma.$transaction(async (tx) => {
          const txAny = tx as any;

          await txAny.matchmakingQueue.deleteMany({
            where: {
              userId: {
                in: [user.id, opponentEntry.userId],
              },
            },
          });

          return txAny.match.create({
            data: {
              roomId,
              status: "PLAYING",
              boardSize,
              winLength: 5,
              currentTurn: "X",
              isRated: queueType === "RANKED",
              startedAt: new Date(),
              players: {
                create: [
                  {
                    userId: xUserId,
                    role: "X",
                  },
                  {
                    userId: oUserId,
                    role: "O",
                  },
                ],
              },
            },
            include: {
              players: {
                orderBy: { joinedAt: "asc" },
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      avatarUrl: true,
                    },
                  },
                },
              },
            },
          });
        });

        const createdMatchId = (createdMatch as { id: string }).id;

        socket.join(roomId);

        const opponentSocketId = matchRuntimeState.getSocketId(opponentEntry.userId);
        if (opponentSocketId) {
          const opponentSocket = io.sockets.sockets.get(opponentSocketId);
          opponentSocket?.join(roomId);
        }

        const state = await getMatchState(createdMatchId);

        if (!state) {
          socket.emit("matchmaking:error", {
            message: "Không tải được trạng thái trận",
          });
          return;
        }

        io.to(roomId).emit("match:found", state);
      } catch (error) {
        console.error("matchmaking:join error", error);
        socket.emit("matchmaking:error", {
          message: "Có lỗi khi tìm trận",
        });
      }
    }
  );

  socket.on("matchmaking:cancel", async () => {
    try {
      const user = socket.data.user;
      if (!user?.id) return;

      matchRuntimeState.clearSearchTimeout(user.id);

      await prisma.matchmakingQueue.deleteMany({
        where: {
          userId: user.id,
          status: "SEARCHING",
        },
      });

      socket.emit("matchmaking:cancelled", {
        message: "Đã hủy tìm trận",
      });
    } catch (error) {
      console.error("matchmaking:cancel error", error);
      socket.emit("matchmaking:error", {
        message: "Không thể hủy tìm trận",
      });
    }
  });

  socket.on("match:join_room", async (payload?: { matchId?: string }) => {
    try {
      const user = socket.data.user;

      if (!user?.id) {
        socket.emit("game:error", { message: "Unauthorized" });
        return;
      }

      const matchId = payload?.matchId;

      if (!matchId) {
        socket.emit("game:error", { message: "Thiếu matchId" });
        return;
      }

      const state = await getMatchState(matchId);

      if (!state) {
        socket.emit("game:error", { message: "Không tìm thấy trận" });
        return;
      }

      const isParticipant = state.players.some((player) => player.userId === user.id);

      if (!isParticipant) {
        socket.emit("game:error", { message: "Bạn không thuộc trận này" });
        return;
      }

      socket.join(state.roomId);
      socket.emit("match:state", state);
    } catch (error) {
      console.error("match:join_room error", error);
      socket.emit("game:error", {
        message: "Không thể vào phòng",
      });
    }
  });

  socket.on(
    "game:move",
    async (payload?: { matchId?: string; x?: number; y?: number }) => {
      try {
        const user = socket.data.user;

        if (!user?.id) {
          socket.emit("game:error", { message: "Unauthorized" });
          return;
        }

        const matchId = payload?.matchId;
        const x = payload?.x;
        const y = payload?.y;

        if (!matchId || !isIntegerNumber(x) || !isIntegerNumber(y)) {
          socket.emit("game:error", { message: "Payload không hợp lệ" });
          return;
        }

        const rawMatch = await prisma.match.findUnique({
          where: { id: matchId },
          include: {
            players: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            moves: {
              orderBy: { moveNumber: "asc" },
              include: {
                player: {
                  select: {
                    id: true,
                    userId: true,
                    role: true,
                  },
                },
              },
            },
          },
        });

        const match = rawMatch as unknown as DbLiveMatchRecord | null;

        if (!match) {
          socket.emit("game:error", { message: "Không tìm thấy trận" });
          return;
        }

        if (match.status !== "PLAYING") {
          socket.emit("game:error", { message: "Trận đã kết thúc" });
          return;
        }

        if (!isInsideBoard(x, y, match.boardSize)) {
          socket.emit("game:error", { message: "Nước đi nằm ngoài bàn cờ" });
          return;
        }

        const currentPlayer = match.players.find((player) => player.userId === user.id);

        if (!currentPlayer) {
          socket.emit("game:error", { message: "Bạn không thuộc trận này" });
          return;
        }

        if (match.currentTurn !== currentPlayer.role) {
          socket.emit("game:error", { message: "Chưa tới lượt của bạn" });
          return;
        }

        const moves = match.moves as unknown as MoveWithRole[];
        const board = buildBoardFromMoves(moves, match.boardSize);
        const row = board[y];

        if (!row) {
          socket.emit("game:error", { message: "Không đọc được bàn cờ" });
          return;
        }

        if (row[x] !== null) {
          socket.emit("game:error", { message: "Ô này đã được đánh" });
          return;
        }

        row[x] = currentPlayer.role;
        const moveNumber = moves.length + 1;

        const winCheck = checkWinFromLastMove(
          board,
          x,
          y,
          currentPlayer.role,
          match.winLength
        );

        try {
          await prisma.$transaction(async (tx) => {
            const txAny = tx as any;

            await txAny.move.create({
              data: {
                matchId: match.id,
                playerId: currentPlayer.id,
                moveNumber,
                x,
                y,
              },
            });

            if (winCheck.won) {
              const loser = match.players.find((player) => player.userId !== user.id);

              await txAny.match.update({
                where: { id: match.id },
                data: {
                  status: "FINISHED",
                  winnerId: user.id,
                  endedType: "WIN",
                  endedAt: new Date(),
                },
              });

              await txAny.matchPlayer.updateMany({
                where: {
                  matchId: match.id,
                  userId: user.id,
                },
                data: {
                  result: "WIN",
                },
              });

              if (loser) {
                await txAny.matchPlayer.updateMany({
                  where: {
                    matchId: match.id,
                    userId: loser.userId,
                  },
                  data: {
                    result: "LOSS",
                  },
                });
              }
            } else if (isBoardFull(board)) {
              await txAny.match.update({
                where: { id: match.id },
                data: {
                  status: "FINISHED",
                  endedType: "DRAW",
                  endedAt: new Date(),
                },
              });

              await txAny.matchPlayer.updateMany({
                where: {
                  matchId: match.id,
                },
                data: {
                  result: "DRAW",
                },
              });
            } else {
              await txAny.match.update({
                where: { id: match.id },
                data: {
                  currentTurn: getOppositeRole(currentPlayer.role),
                },
              });
            }
          });
        } catch (error) {
          if (hasPrismaErrorCode(error, "P2002")) {
            socket.emit("game:error", {
              message: "Nước đi không hợp lệ hoặc đã bị trùng",
            });
            return;
          }

          throw error;
        }

        const latestState = await getMatchState(match.id);

        if (!latestState) {
          socket.emit("game:error", { message: "Không tải được trạng thái mới" });
          return;
        }

        io.to(match.roomId).emit("match:state", latestState);

        if (latestState.status === "FINISHED") {
          const winnerUserId = latestState.winnerId;

          if (latestState.endedType === "WIN" && winnerUserId) {
            const loserUserId = latestState.players.find(
              (player) => player.userId !== winnerUserId
            )?.userId;

            if (loserUserId) {
              await updateStatsAfterWin(winnerUserId, loserUserId);
            }
          } else if (latestState.endedType === "DRAW") {
            await updateStatsAfterDraw(
              latestState.players.map((player) => player.userId)
            );
          }

          io.to(match.roomId).emit("match:ended", {
            matchId: latestState.matchId,
            winnerId: latestState.winnerId,
            endedType: latestState.endedType,
            winningCells: latestState.winningCells,
          });
        }
      } catch (error) {
        console.error("game:move error", error);
        socket.emit("game:error", { message: "Không thể thực hiện nước đi" });
      }
    }
  );

  socket.on("game:surrender", async (payload?: { matchId?: string }) => {
    try {
      const user = socket.data.user;

      if (!user?.id) {
        socket.emit("game:error", { message: "Unauthorized" });
        return;
      }

      const matchId = payload?.matchId;

      if (!matchId) {
        socket.emit("game:error", { message: "Thiếu matchId" });
        return;
      }

      const rawMatch = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
        },
      });

      const match = rawMatch as unknown as DbSurrenderMatchRecord | null;

      if (!match) {
        socket.emit("game:error", { message: "Không tìm thấy trận" });
        return;
      }

      if (match.status !== "PLAYING") {
        socket.emit("game:error", { message: "Trận đã kết thúc" });
        return;
      }

      const currentPlayer = match.players.find((player) => player.userId === user.id);
      const opponent = match.players.find((player) => player.userId !== user.id);

      if (!currentPlayer || !opponent) {
        socket.emit("game:error", { message: "Không đủ người chơi" });
        return;
      }

      await prisma.$transaction(async (tx) => {
        const txAny = tx as any;

        await txAny.match.update({
          where: { id: match.id },
          data: {
            status: "FINISHED",
            winnerId: opponent.userId,
            endedType: "SURRENDER",
            endedAt: new Date(),
          },
        });

        await txAny.matchPlayer.updateMany({
          where: {
            matchId: match.id,
            userId: opponent.userId,
          },
          data: {
            result: "WIN",
          },
        });

        await txAny.matchPlayer.updateMany({
          where: {
            matchId: match.id,
            userId: user.id,
          },
          data: {
            result: "LOSS",
          },
        });
      });

      await updateStatsAfterWin(opponent.userId, user.id);

      const latestState = await getMatchState(match.id);

      if (latestState) {
        io.to(match.roomId).emit("match:state", latestState);
        io.to(match.roomId).emit("match:ended", {
          matchId: latestState.matchId,
          winnerId: latestState.winnerId,
          endedType: latestState.endedType,
          winningCells: [],
        });
      }
    } catch (error) {
      console.error("game:surrender error", error);
      socket.emit("game:error", { message: "Không thể đầu hàng" });
    }
  });

  socket.on("disconnect", async () => {
    try {
      const user = socket.data.user;
      if (!user?.id) return;

      matchRuntimeState.clearSearchTimeout(user.id);
      matchRuntimeState.removeUserSocket(user.id);

      await prisma.matchmakingQueue.deleteMany({
        where: {
          userId: user.id,
          status: "SEARCHING",
        },
      });
    } catch (error) {
      console.error("disconnect cleanup error", error);
    }
  });
}