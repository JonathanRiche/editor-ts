import type { EditorTsSyncAck, EditorTsSyncEnvelope, EditorTsSyncMessage, PagePayload } from '../types';

export const isSyncMessage = (message: EditorTsSyncEnvelope): message is EditorTsSyncMessage => {
  return message.type === 'page';
};

export const isSyncAck = (message: EditorTsSyncEnvelope): message is EditorTsSyncAck => {
  return message.type === 'ack';
};

export const createSyncMessage = (payload: PagePayload, options?: { key?: string }): EditorTsSyncMessage => {
  return {
    type: 'page',
    payload,
    key: options?.key,
    sentAt: new Date().toISOString(),
  };
};

export const createSyncAck = (messageId: string): EditorTsSyncAck => {
  return {
    type: 'ack',
    messageId,
    receivedAt: new Date().toISOString(),
  };
};

export const parseSyncEnvelope = (raw: string): EditorTsSyncEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as EditorTsSyncEnvelope;
    if (parsed && (parsed.type === 'page' || parsed.type === 'ack')) {
      return parsed;
    }
  } catch (error: unknown) {
    return null;
  }
  return null;
};
