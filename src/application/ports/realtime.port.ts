// --> Real-time delivery used by services, services depend on this interface only
// every gateway that should be used by services implements it
export interface RealtimePort {
  emitToUser(userId: string, event: string, payload: unknown): void
  emitToRoom(roomId: string, event: string, payload: unknown): void
}
