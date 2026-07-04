export type AppServerNotificationListener<T> = (value: T) => void

export class AppServerNotificationListeners<T> {
  private readonly listeners = new Set<AppServerNotificationListener<T>>()

  get count(): number {
    return this.listeners.size
  }

  subscribe(listener: AppServerNotificationListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
