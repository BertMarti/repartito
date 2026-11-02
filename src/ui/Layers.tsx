import { useI18n } from '../i18n';
import { useApp, type Layer } from './context';
import { Sheet } from './Sheet';
import { ConfirmSheet } from './sheets/ConfirmSheet';
import { ExpenseSheet } from './sheets/ExpenseSheet';
import { GroupSettingsSheet } from './sheets/GroupSettingsSheet';
import { ImportSheet } from './sheets/ImportSheet';
import { IncomingSheet } from './sheets/IncomingSheet';
import { NewGroupSheet } from './sheets/NewGroupSheet';
import { PhotoView } from './sheets/PhotoField';
import { RecurringSheet } from './sheets/RecurringSheet';
import { SettingsSheet } from './sheets/SettingsSheet';
import { SharePickSheet } from './sheets/SharePickSheet';
import { ShareSheet } from './sheets/ShareSheet';
import { WhoAmISheet } from './sheets/WhoAmISheet';

export interface SheetProps {
  active: boolean;
  onClose: () => void;
}

/** Pinta la hoja que corresponde a cada capa de la pila. */
export function LayerView({ layer, active }: { layer: Layer; active: boolean }) {
  const { pop, groups } = useApp();
  const { t } = useI18n();
  const onClose = () => pop();
  const p = { active, onClose };
  const groupOf = (id: string) => groups.find((g) => g.id === id);
  switch (layer.t) {
    case 'group':
      return null;
    case 'newGroup':
      return <NewGroupSheet {...p} />;
    case 'settings':
      return <SettingsSheet {...p} />;
    case 'import':
      return <ImportSheet {...p} restore={layer.restore ?? false} />;
    case 'incoming':
      return <IncomingSheet {...p} source={layer.source} />;
    case 'confirm':
      return <ConfirmSheet {...p} spec={layer} />;
    case 'sharePick':
      return <SharePickSheet {...p} shared={layer.shared} />;
    case 'photo':
      return (
        <Sheet {...p} title={t('photo.title')}>
          <PhotoView src={layer.src} title={layer.title} />
        </Sheet>
      );
    default: {
      const group = groupOf(layer.groupId);
      if (!group) return null;
      switch (layer.t) {
        case 'expense':
          // La clave obliga a empezar de cero al cambiar «editar» por «repetir» en la misma posición de la pila.
          return <ExpenseSheet key={layer.repeatOf ? `r-${layer.repeatOf}` : (layer.expenseId ?? 'new')} {...p} group={group} expenseId={layer.expenseId} kind={layer.kind} repeatOf={layer.repeatOf} shared={layer.shared} />;
        case 'recurring':
          return <RecurringSheet {...p} group={group} recurringId={layer.recurringId} />;
        case 'groupSettings':
          return <GroupSettingsSheet {...p} group={group} />;
        case 'whoami':
          return <WhoAmISheet {...p} group={group} />;
        case 'share':
          return <ShareSheet {...p} group={group} />;
      }
    }
  }
}
