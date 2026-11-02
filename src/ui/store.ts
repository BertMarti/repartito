/**
 * Estado de la app fuera de React (se lee con useSyncExternalStore). Aquí viven los grupos, los ajustes,
 * la pila de navegación (sincronizada con el historial para que «atrás» cierre hojas) y los avisos.
 *
 * Todo cambio de grupos se guarda al momento con `saveGroups`. Lo que llega de fuera (enlace, archivo,
 * otra pestaña) entra solo a través de las funciones validadoras del dominio.
 */
import {
  clearLegacyStorage,
  incomingProblem,
  loadGroups,
  loadSettings,
  materializeRecurring,
  mergeGroups,
  migrateLegacyStorage,
  payloadFromHash,
  revalidate,
  saveGroups,
  saveSettings,
  StorageFullError,
  today,
  type Group,
  type Settings,
} from '../core';
import { makeI18n, type Key } from '../i18n';
import type { AppApi, ConfirmSpec, Layer, Tab, ToastTone } from './context';
import { clearPhotos, deletePhotos, photos, prunePhotos, refreshPhotoIds, removeGroupPhotos } from './photos';
import { maxImageMb, routeShare, SHARE_FLAG, shareSource, type RawShare, type SharedDraft, type ShareProblem } from './shareTarget';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

export interface State {
  groups: Group[];
  settings: Settings;
  layers: Layer[];
  toasts: Toast[];
  storageError: boolean;
  highlight: string | null;
  celebrate: number;
}

type Actions = Omit<AppApi, keyof State | 'online'>;

const SHARE_ERROR_KEYS = {
  type: 'share.err.type',
  read: 'share.err.read',
  empty: 'share.err.empty',
  foreign: 'share.err.foreign',
} as const satisfies Record<Exclude<ShareProblem, 'size'>, Key>;

const GROUPS_KEY = 'repartito:v1:grupos';
/** Copias en bruto de los datos que no pasaron la validación al abrir: `<prefijo><marca de tiempo>`. */
export const DAMAGED_PREFIX = 'repartito:v1:grupos-danados:';
const MAX_DAMAGED = 3;

/** Claves de las copias apartadas, de la más reciente a la más antigua. */
export function damagedKeys(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(DAMAGED_PREFIX))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Los grupos válidos se materializan; si el resultado no pasa la validación, se deja el grupo como estaba. */
function materialized(g: Group): { group: Group; added: number } {
  const r = materializeRecurring(g, today());
  if (r.added === 0) return r;
  try {
    return { group: revalidate(r.group), added: r.added };
  } catch {
    return { group: g, added: 0 };
  }
}

export class AppStore {
  private state: State;
  private listeners = new Set<() => void>();
  private booted = false;
  private damaged: number;
  private toastSeq = 0;
  /** Profundidad que creemos que tiene el historial (entradas propias por encima de la base). */
  private histDepth = 0;
  private flushQueued = false;
  readonly actions: Actions;

  constructor() {
    migrateLegacyStorage();
    const { groups, damaged } = loadGroups();
    this.damaged = damaged;
    if (damaged > 0) {
      // loadGroups aparta los grupos dañados, pero el siguiente guardado los sobrescribiría: copia en bruto con
      // fecha (se guardan las últimas). Desde Ajustes se pueden descargar.
      try {
        const raw = localStorage.getItem(GROUPS_KEY);
        if (raw && !damagedKeys().some((k) => localStorage.getItem(k) === raw)) {
          localStorage.setItem(`${DAMAGED_PREFIX}${Date.now()}`, raw);
          for (const k of damagedKeys().slice(MAX_DAMAGED)) localStorage.removeItem(k);
        }
      } catch {
        /* sin espacio: no podemos hacer más */
      }
    }
    this.state = { groups, settings: loadSettings(), layers: [], toasts: [], storageError: false, highlight: null, celebrate: 0 };
    this.actions = {
      commit: this.commit,
      addOrMerge: this.addOrMerge,
      removeGroup: this.removeGroup,
      removeAll: this.removeAll,
      setSettings: this.setSettings,
      setMe: this.setMe,
      push: this.push,
      pop: this.pop,
      setLayers: this.setLayers,
      openGroup: this.openGroup,
      openShared: this.openShared,
      setTab: this.setTab,
      goHome: this.goHome,
      toast: this.toast,
      confirm: this.confirm,
      setHighlight: this.setHighlight,
      triggerCelebrate: this.triggerCelebrate,
    };
  }

  getState = (): State => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private tr() {
    return makeI18n(this.state.settings.lang);
  }

  /* ---------- Arranque y eventos del navegador ---------- */

  boot = () => {
    if (this.booted) return;
    this.booted = true;
    const shared = this.takeShareFlag();
    const payload = this.takeHash();
    history.replaceState({ repartito: 0 }, '');
    let added = 0;
    const next = this.state.groups.map((g) => {
      const r = materialized(g);
      added += r.added;
      return r.group;
    });
    if (added > 0) {
      this.persist(next);
      this.toast(this.tr().tp('toast.recurring', added), 'info');
    }
    if (this.damaged > 0) this.toast(this.tr().tp('toast.damaged', this.damaged), 'error');
    const last = this.state.settings.lastGroup;
    // Fotos de gastos que ya no existen (p. ej. borrados en otra pestaña): fuera. Luego, qué gastos tienen foto.
    void prunePhotos(this.state.groups).catch(() => refreshPhotoIds());
    if (payload) this.setLayers([{ t: 'incoming', source: { kind: 'link', payload } }]);
    else if (last && this.state.groups.some((g) => g.id === last)) this.setLayers([{ t: 'group', id: last, tab: 'gastos' }]);
    this.bootShare(shared);
  };

  /* ---------- Compartir con Repartito (menú de compartir del móvil) ---------- */

  /** `#compartido` (fijo, sin datos): el service worker acaba de dejar algo. Se borra de la barra al momento. */
  private takeShareFlag(): boolean {
    if (location.hash !== SHARE_FLAG) return false;
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  private bootShare(flagged: boolean) {
    const src = shareSource();
    if (!src) return;
    // En la web solo se recoge si se acaba de compartir; si no, cualquier resto se borra sin mirarlo. En la app, el
    // plugin entrega lo que haya (también lo que llega con la app abierta).
    if (flagged || src.listen) void this.pickUpShare(flagged);
    else void src.discard().catch(() => undefined);
    src.listen?.(() => void this.pickUpShare(false));
  }

  private pickUpShare = async (expected: boolean) => {
    let raw: RawShare | null;
    try {
      raw = (await shareSource()?.take()) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) {
      if (expected) this.toast(this.tr().t('share.err.lost'), 'error');
      return;
    }
    await this.receiveShare(raw);
  };

  /** Lo compartido, ya recogido: enlace de grupo → vista previa y fusión; foto o texto → «Nuevo gasto». */
  receiveShare = async (raw: RawShare) => {
    const r = await routeShare(raw);
    const tr = this.tr();
    if (r.kind === 'link') {
      // Exactamente como abrir el enlace: `IncomingSheet` lo decodifica, lo valida y pide confirmación.
      this.setLayers([...this.state.layers, { t: 'incoming', source: { kind: 'link', payload: r.payload } }]);
      return;
    }
    if (r.kind === 'error') {
      this.toast(r.error === 'size' ? tr.t('share.err.size', { mb: maxImageMb() }) : tr.t(SHARE_ERROR_KEYS[r.error]), 'error');
      return;
    }
    let shared: SharedDraft = { file: r.file, title: r.title };
    if (shared.file && !photos()) {
      shared = { ...shared, file: null };
      this.toast(tr.t('share.noPhotos'), 'info');
    } else if (shared.file && raw.ignored > 0) this.toast(tr.t('share.onlyOne'), 'info');
    const groups = this.state.groups;
    if (groups.length === 0) {
      this.toast(tr.t('share.noGroup'), 'info');
      return;
    }
    if (groups.length === 1) this.openShared(groups[0]!.id, shared);
    else this.push({ t: 'sharePick', shared });
  };

  openShared = (groupId: string, shared: SharedDraft) => {
    if (!this.state.groups.some((g) => g.id === groupId)) return;
    const layers = this.state.layers.filter((l) => l.t !== 'sharePick');
    const expense = { t: 'expense' as const, groupId, shared };
    // Sin hojas abiertas, se abre el grupo debajo; si había alguna (p. ej. con la app ya abierta), no se pierde.
    if (layers.some((l) => l.t !== 'group')) this.setLayers([...layers, expense]);
    else this.openGroup(groupId, [expense]);
  };

  /** Lee `#g=…`, lo guarda en memoria y lo borra de la barra (y del historial) al momento. */
  private takeHash(): string | null {
    if (!location.hash.startsWith('#g=')) return null;
    const payload = payloadFromHash(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!payload) this.toast(this.tr().t('incoming.err.format'), 'error');
    return payload;
  }

  onHashChange = () => {
    if (this.takeShareFlag()) {
      void this.pickUpShare(true);
      return;
    }
    const payload = this.takeHash();
    if (payload) this.setLayers([...this.state.layers, { t: 'incoming', source: { kind: 'link', payload } }]);
  };

  onPopState = (e: PopStateEvent) => {
    const s = e.state as { repartito?: unknown } | null;
    const depth = typeof s?.repartito === 'number' ? s.repartito : 0;
    this.histDepth = depth;
    if (depth < this.state.layers.length) this.set({ layers: this.state.layers.slice(0, depth) });
  };

  /** Otra pestaña cambió los datos: se recargan (validados). */
  onStorage = (e: StorageEvent) => {
    if (e.key !== null && !e.key.startsWith('repartito:')) return;
    this.set({ groups: loadGroups().groups, settings: loadSettings() });
  };

  /* ---------- Grupos ---------- */

  private persist(groups: Group[]) {
    let storageError = false;
    try {
      saveGroups(groups);
    } catch (e) {
      if (!(e instanceof StorageFullError)) throw e;
      storageError = true;
    }
    this.set({ groups, storageError });
  }

  commit = (groupId: string, fn: (g: Group) => Group) => {
    const g = this.state.groups.find((x) => x.id === groupId);
    if (!g) return false;
    let next: Group;
    try {
      next = fn(g);
    } catch {
      // P. ej. cambiar la moneda del grupo cuando, mientras tanto, ha llegado un gasto en otra moneda.
      this.toast(this.tr().t('toast.notApplied'), 'error');
      return false;
    }
    if (next === g) return false;
    // Nunca se guarda algo que al reabrir no pasaría la validación (p. ej. por encima de los límites).
    try {
      revalidate(next);
    } catch {
      this.toast(this.tr().t('toast.tooBig'), 'error');
      return false;
    }
    this.persist(this.state.groups.map((x) => (x.id === groupId ? next : x)));
    // Un gasto borrado se lleva su foto (que solo vive en este dispositivo).
    const before = new Map(g.expenses.map((e) => [e.id, e]));
    const gone = next.expenses.filter((e) => e.deleted && before.get(e.id)?.deleted !== true).map((e) => e.id);
    void deletePhotos(gone).catch(() => undefined);
    return true;
  };

  /** Añade o fusiona grupos de fuera. Los que darían problemas (ver `incomingProblem`) no se tocan. */
  addOrMerge = (list: Group[]) => {
    let added = 0;
    let merged = 0;
    let rejected = 0;
    let groups = this.state.groups;
    for (const incoming of list) {
      const local = groups.find((g) => g.id === incoming.id);
      if (incomingProblem(local, incoming)) {
        rejected++;
        continue;
      }
      if (local) {
        const m = materialized(revalidate(mergeGroups(local, incoming))).group;
        groups = groups.map((g) => (g.id === m.id ? m : g));
        merged++;
      } else {
        groups = [...groups, materialized(incoming).group];
        added++;
      }
    }
    if (added + merged > 0) {
      this.persist(groups);
      // Los borrados que llegan al fusionar también se llevan las fotos de este dispositivo.
      if (merged > 0) void prunePhotos(groups).catch(() => undefined);
    }
    return { added, merged, rejected };
  };

  removeGroup = (id: string) => {
    this.persist(this.state.groups.filter((g) => g.id !== id));
    void removeGroupPhotos(id).catch(() => undefined);
    const me = { ...this.state.settings.me };
    delete me[id];
    const { lastGroup, ...rest } = this.state.settings;
    this.setSettings({ ...rest, me, ...(lastGroup && lastGroup !== id ? { lastGroup } : {}) }, true);
  };

  removeAll = () => {
    this.persist([]);
    // «Borrar todo» es todo: también las fotos de los tickets…
    void clearPhotos().catch(() => undefined);
    // …y lo que quedara con el nombre antiguo («a medias»).
    clearLegacyStorage();
    try {
      for (const k of damagedKeys()) localStorage.removeItem(k);
    } catch {
      /* nada */
    }
    this.setSettings({ lang: this.state.settings.lang, theme: this.state.settings.theme, me: {} }, true);
    this.setLayers([]);
  };

  setSettings = (patch: Partial<Settings>, replace = false) => {
    const next = replace ? (patch as Settings) : { ...this.state.settings, ...patch };
    saveSettings(next);
    this.set({ settings: next });
  };

  setMe = (groupId: string, memberId: string) => {
    this.setSettings({ me: { ...this.state.settings.me, [groupId]: memberId } });
  };

  /* ---------- Navegación ---------- */

  /** Cambia la pila de capas; el historial se ajusta (en bloque, una vez por tarea) para que «atrás» funcione. */
  setLayers = (next: Layer[]) => {
    this.set({ layers: next });
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const target = this.state.layers.length;
      const diff = target - this.histDepth;
      if (diff > 0) for (let i = this.histDepth + 1; i <= target; i++) history.pushState({ repartito: i }, '');
      else if (diff < 0) history.go(diff);
      this.histDepth = target;
    });
  };

  push = (layer: Layer) => this.setLayers([...this.state.layers, layer]);

  pop = (n = 1) => this.setLayers(this.state.layers.slice(0, Math.max(0, this.state.layers.length - n)));

  openGroup = (id: string, extra: Layer[] = []) => {
    const g = this.state.groups.find((x) => x.id === id);
    if (!g) return;
    const r = materializeRecurring(g, today());
    if (r.added > 0) {
      this.commit(id, () => r.group);
      this.toast(this.tr().tp('toast.recurring', r.added), 'info');
    }
    this.setSettings({ lastGroup: id });
    this.setLayers([{ t: 'group', id, tab: 'gastos' }, ...extra]);
  };

  setTab = (tab: Tab) => {
    const layers = [...this.state.layers];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      if (l.t === 'group') {
        layers[i] = { ...l, tab };
        break;
      }
    }
    this.set({ layers });
  };

  goHome = () => {
    this.setSettings({ lastGroup: undefined });
    this.setLayers([]);
  };

  /* ---------- Avisos ---------- */

  toast = (text: string, tone: ToastTone = 'ok') => {
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts.slice(-2), { id, text, tone }] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((x) => x.id !== id) }), tone === 'error' ? 6000 : 3800);
  };

  confirm = (spec: ConfirmSpec) => this.push({ t: 'confirm', ...spec });

  setHighlight = (id: string | null) => this.set({ highlight: id });

  triggerCelebrate = () => this.set({ celebrate: this.state.celebrate + 1 });
}
