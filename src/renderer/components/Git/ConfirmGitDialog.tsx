import type { Confirm, NeedsConfirm } from '../../../shared/ipc-contract';
import { ConfirmDialog } from '../ConfirmDialog';

interface Copy {
  title: string;
  confirmLabel: string;
  danger: boolean;
}

const COPY: Record<Confirm, Copy> = {
  'amend-published': { title: 'Alterar um commit já publicado', confirmLabel: 'Alterar mesmo assim', danger: true },
  'push-main': { title: 'Enviar para a branch principal', confirmLabel: 'Enviar', danger: false },
  'checkout-dirty': { title: 'Trocar de branch com alterações pendentes', confirmLabel: 'Trocar', danger: true },
  discard: { title: 'Descartar alterações', confirmLabel: 'Descartar', danger: true },
  'set-upstream': { title: 'Publicar a branch', confirmLabel: 'Publicar', danger: false },
  'merge-dirty': { title: 'Há alterações não commitadas', confirmLabel: 'Continuar', danger: true },
  'abort-merge': { title: 'Abortar o merge', confirmLabel: 'Abortar merge', danger: true },
};

const ACTION_LABEL = { apagar: 'apagar o arquivo', reverter: 'reverter ao último commit' } as const;

function Explanation({ request }: { request: NeedsConfirm }) {
  const { branch, remote } = request.details;
  switch (request.needsConfirm) {
    case 'amend-published':
      return (
        <p>
          Este commit já está no remoto. Alterá-lo reescreve a história: o próximo push será recusado e exigiria um
          force push, que este app não faz.
        </p>
      );
    case 'push-main':
      return (
        <p>
          Você vai enviar commits direto para <strong>{branch ?? 'a branch principal'}</strong>
          {remote ? ` em ${remote}` : ''}. Confirme que é isso mesmo.
        </p>
      );
    case 'checkout-dirty':
      return (
        <p>
          Os arquivos abaixo têm alterações que não foram commitadas. Trocar para{' '}
          <strong>{branch ?? 'a outra branch'}</strong> pode levá-las junto ou falhar se houver conflito.
        </p>
      );
    case 'discard':
      return <p>As alterações abaixo serão perdidas e não podem ser desfeitas.</p>;
    case 'set-upstream':
      return (
        <p>
          A branch <strong>{branch ?? 'atual'}</strong> ainda não existe em {remote ?? 'nenhum remoto'}. O push vai
          criá-la lá e passar a acompanhá-la.
        </p>
      );
    case 'merge-dirty':
      return (
        <p>
          Existem alterações não commitadas na pasta. Elas podem se misturar com o resultado do merge ou impedi-lo.
        </p>
      );
    case 'abort-merge':
      return (
        <p>
          As resoluções feitas até agora serão descartadas e a pasta volta ao estado anterior ao merge.
        </p>
      );
  }
}

export interface ConfirmGitDialogProps {
  request: NeedsConfirm;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação de uma operação que pode perder trabalho; mostra o que será afetado. */
export function ConfirmGitDialog({ request, busy, onConfirm, onCancel }: ConfirmGitDialogProps) {
  const copy = COPY[request.needsConfirm];
  const files = request.details.files ?? [];
  return (
    <ConfirmDialog
      title={copy.title}
      confirmLabel={copy.confirmLabel}
      danger={copy.danger}
      {...(busy === undefined ? {} : { busy })}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <Explanation request={request} />
      {files.length > 0 && (
        <ul className="git-confirm-files" data-testid="git-confirm-files">
          {files.map((f) => (
            <li key={f.path}>
              <code>{f.path}</code>
              {f.action ? <span className="meta"> — {ACTION_LABEL[f.action]}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  );
}
