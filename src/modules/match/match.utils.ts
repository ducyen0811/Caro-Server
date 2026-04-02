export type Role = "X" | "O";
export type BoardCell = Role | null;

export type MoveWithRole = {
  id: string;
  moveNumber: number;
  x: number;
  y: number;
  createdAt: Date;
  player: {
    id: string;
    userId: string;
    role: Role;
  };
};

export function createEmptyBoard(size: number): BoardCell[][] {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

export function buildBoardFromMoves(
  moves: MoveWithRole[],
  boardSize: number
): BoardCell[][] {
  const board = createEmptyBoard(boardSize);

  for (const move of moves) {
    if (
      move.y >= 0 &&
      move.y < boardSize &&
      move.x >= 0 &&
      move.x < boardSize
    ) {
      board[move.y][move.x] = move.player.role;
    }
  }

  return board;
}

export function getOppositeRole(role: Role): Role {
  return role === "X" ? "O" : "X";
}

export function isInsideBoard(x: number, y: number, boardSize: number) {
  return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
}

export function isBoardFull(board: BoardCell[][]) {
  return board.every((row) => row.every((cell) => cell !== null));
}

export function checkWinFromLastMove(
  board: BoardCell[][],
  x: number,
  y: number,
  role: Role,
  winLength: number
): { won: boolean; cells: Array<{ x: number; y: number }> } {
  const directions = [
    { dx: 1, dy: 0 }, // ngang
    { dx: 0, dy: 1 }, // dọc
    { dx: 1, dy: 1 }, // chéo xuống
    { dx: 1, dy: -1 }, // chéo lên
  ];

  for (const { dx, dy } of directions) {
    const line: Array<{ x: number; y: number }> = [{ x, y }];

    let nx = x + dx;
    let ny = y + dy;

    while (
      ny >= 0 &&
      ny < board.length &&
      nx >= 0 &&
      nx < board.length &&
      board[ny][nx] === role
    ) {
      line.push({ x: nx, y: ny });
      nx += dx;
      ny += dy;
    }

    nx = x - dx;
    ny = y - dy;

    while (
      ny >= 0 &&
      ny < board.length &&
      nx >= 0 &&
      nx < board.length &&
      board[ny][nx] === role
    ) {
      line.unshift({ x: nx, y: ny });
      nx -= dx;
      ny -= dy;
    }

    if (line.length >= winLength) {
      return {
        won: true,
        cells: line,
      };
    }
  }

  return { won: false, cells: [] };
}