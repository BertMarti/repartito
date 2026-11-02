import { createContext, useContext } from 'react';
import type { Group, Settings } from '../core';
import type { SharedDraft } from './shareTarget';

export type Tab = 'gastos' | 'saldos' | 'resumen' | 'fijos';

export interface ConfirmSpec {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export type IncomingSource =
  | { kind: 'link'; payload: string }
  | { kind: 'groups'; groups: Group[]; note?: string; restore?: boolean };

/** Capas de navegación: la pantalla de grupo y las hojas que se abren encima. Cada una es una entrada del historial. */
export type Layer =
  | { t: 'group'; id: string; tab: Tab }
  | { t: 'newGroup' }
  /**
   * `repeatOf`: gasto nuevo copiado de otro («Repetir»), con fecha de hoy. `shared`: gasto nuevo con lo que llegó del
   * menú de compartir del móvil (foto del ticket y concepto); solo en memoria, como la foto en grande.
   */
  | { t: 'expense'; groupId: string; expenseId?: string; kind?: 'expense' | 'transfer'; repeatOf?: string; shared?: SharedDraft }
  /** «¿En qué grupo?» para algo compartido con la app cuando hay varios grupos. */
  | { t: 'sharePick'; shared: SharedDraft }
  /** Foto de un ticket a pantalla completa (la imagen ya está en memoria: no pasa por el historial). */
  | { t: 'photo'; src: string; title: string }
  | { t: 'recurring'; groupId: string; recurringId?: string }
  | { t: 'groupSettings'; groupId: string }
  | { t: 'whoami'; groupId: string }
  | { t: 'share'; groupId: string }
  | { t: 'import'; restore?: boolean }
  | { t: 'incoming'; source: IncomingSource }
  | { t: 'settings' }
  | ({ t: 'confirm' } & ConfirmSpec);

export type ToastTone = 'ok' | 'info' | 'error';

export interface AppApi {
  groups: Group[];
  settings: Settings;
  online: boolean;
  /** Aplica un cambio a un grupo y lo guarda. */
  /** Devuelve si se guardó (un cambio que ya no se puede aplicar o no pasaría la validación se avisa y no se guarda). */
  commit: (groupId: string, fn: (g: Group) => Group) => boolean;
  /** Añade grupos nuevos o fusiona con los que ya existen (mismo id). */
  addOrMerge: (list: Group[]) => { added: number; merged: number; rejected: number };
  removeGroup: (id: string) => void;
  removeAll: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  setMe: (groupId: string, memberId: string) => void;
  layers: Layer[];
  push: (layer: Layer) => void;
  pop: (n?: number) => void;
  setLayers: (next: Layer[]) => void;
  openGroup: (id: string, extra?: Layer[]) => void;
  /** Abre «Nuevo gasto» en ese grupo con lo compartido desde el móvil. */
  openShared: (groupId: string, shared: SharedDraft) => void;
  setTab: (tab: Tab) => void;
  goHome: () => void;
  toast: (text: string, tone?: ToastTone) => void;
  confirm: (spec: ConfirmSpec) => void;
  /** Id del último gasto añadido (para animarlo). */
  highlight: string | null;
  setHighlight: (id: string | null) => void;
  /** Se incrementa al quedar todo saldado tras marcar un pago (dispara el confeti). */
  celebrate: number;
  triggerCelebrate: () => void;
}

export const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext');
  return v;
}

export function useGroup(id: string): Group | undefined {
  return useApp().groups.find((g) => g.id === id);
}
