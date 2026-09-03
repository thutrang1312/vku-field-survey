import { Network, type ConnectionStatus } from '@capacitor/network';
import type { NetworkState } from '../types/survey';

type NetworkListener = (state: NetworkState) => void;

class NetworkService {
  private listeners: Set<NetworkListener> = new Set();
  private currentState: NetworkState = {
    connected: navigator.onLine,
    connectionType: 'unknown',
  };

  constructor() {
    this.init();
  }

  private async init() {
    // Lấy trạng thái mạng ban đầu từ Capacitor
    try {
      const status: ConnectionStatus = await Network.getStatus();
      this.currentState = {
        connected: status.connected,
        connectionType: status.connectionType,
      };
    } catch {
      this.currentState = {
        connected: navigator.onLine,
        connectionType: 'browser',
      };
    }

    // Lắng nghe thay đổi từ @capacitor/network
    try {
      Network.addListener('networkStatusChange', (status: ConnectionStatus) => {
        this.updateState({
          connected: status.connected,
          connectionType: status.connectionType,
        });
      });
    } catch (e) {
      console.warn('[Network] Capacitor Network listener không khả dụng:', e);
    }

    // Fallback chuẩn Web: lắng nghe window online / offline
    window.addEventListener('online', () => {
      this.updateState({
        connected: true,
        connectionType: this.currentState.connectionType || 'browser',
      });
    });

    window.addEventListener('offline', () => {
      this.updateState({
        connected: false,
        connectionType: 'none',
      });
    });
  }

  private updateState(newState: NetworkState) {
    const changed =
      this.currentState.connected !== newState.connected ||
      this.currentState.connectionType !== newState.connectionType;

    this.currentState = newState;

    if (changed) {
      console.log('[Network] Trạng thái mạng thay đổi:', newState);
      this.notify();
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('[Network] Lỗi trong listener:', err);
      }
    }
  }

  public getState(): NetworkState {
    return { ...this.currentState };
  }

  public async isOnline(): Promise<boolean> {
    try {
      const status = await Network.getStatus();
      return status.connected;
    } catch {
      return navigator.onLine;
    }
  }

  public subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    // Gửi ngay trạng thái hiện tại
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const networkService = new NetworkService();

