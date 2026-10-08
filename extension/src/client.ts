import { NativeReply } from './core';
let readerTab: number | undefined;
let readerToken = '';
export function bindReaderTab(id: number | undefined, token = '') { readerTab = id; readerToken = token; }
export async function openHistory(id: string): Promise<NativeReply> {
  const reply = await browser.runtime.sendMessage({ type: 'paperchat.open-history', id, readerTab, readerToken }) as NativeReply;
  if (!reply?.ok) throw new Error(reply?.error ?? 'The saved paper could not be opened.');
  return reply;
}
export async function native(payload: Record<string, any>): Promise<NativeReply> {
  const reply = await browser.runtime.sendMessage({ type: 'paperchat.native', payload, readerTab, readerToken }) as NativeReply;
  if (!reply?.ok) throw new Error(reply?.error ?? 'The PaperChat companion app is unavailable.');
  return reply;
}
