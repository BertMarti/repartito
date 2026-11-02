import { useI18n } from '../../i18n';
import { useApp } from '../context';
import { Icon } from '../icons';
import type { SheetProps } from '../Layers';
import type { SharedDraft } from '../shareTarget';
import { Sheet } from '../Sheet';

/** «¿En qué grupo?»: algo compartido con la app (foto o texto) y varios grupos. El último abierto, primero. */
export function SharePickSheet({ active, onClose, shared }: SheetProps & { shared: SharedDraft }) {
  const { t } = useI18n();
  const { groups, settings, openShared } = useApp();
  const last = settings.lastGroup;
  const list = [...groups].sort((a, b) => Number(b.id === last) - Number(a.id === last));
  return (
    <Sheet title={t('share.pickTitle')} active={active} onClose={onClose} size="sm" description={t('share.pickBody')}>
      <ul className="pick-list">
        {list.map((g) => (
          <li key={g.id}>
            <button type="button" className={`pick${g.id === last ? ' pick--on' : ''}`} onClick={() => openShared(g.id, shared)} aria-describedby={g.id === last ? 'share-last' : undefined}>
              <span className="group-emoji pick-emoji" aria-hidden="true">
                {g.emoji}
              </span>
              <span className="pick-main">
                <span className="pick-name">{g.name}</span>
                {g.id === last && (
                  <span id="share-last" className="muted small">
                    {t('share.last')}
                  </span>
                )}
              </span>
              <Icon name="arrow" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
