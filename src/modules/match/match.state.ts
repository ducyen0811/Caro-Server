type SearchTimeout = NodeJS.Timeout;

class MatchRuntimeState {
  private userSocketMap = new Map<string, string>();
  private searchTimeoutMap = new Map<string, SearchTimeout>();

  setUserSocket(userId: string, socketId: string) {
    this.userSocketMap.set(userId, socketId);
  }

  getSocketId(userId: string) {
    return this.userSocketMap.get(userId);
  }

  removeUserSocket(userId: string) {
    this.userSocketMap.delete(userId);
  }

  setSearchTimeout(userId: string, timeout: SearchTimeout) {
    this.clearSearchTimeout(userId);
    this.searchTimeoutMap.set(userId, timeout);
  }

  clearSearchTimeout(userId: string) {
    const timeout = this.searchTimeoutMap.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.searchTimeoutMap.delete(userId);
    }
  }
}

export const matchRuntimeState = new MatchRuntimeState();