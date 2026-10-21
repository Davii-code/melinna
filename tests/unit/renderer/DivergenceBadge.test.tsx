import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DivergenceBadge } from '../../../src/renderer/components/DivergenceBadge';
import { PanelHeader } from '../../../src/renderer/components/Panel/PanelHeader';
import { TreeExecution } from '../../../src/renderer/components/Tree/TreeExecution';
import { agentDef, execution } from '../../support/renderer-fixtures';

const noop = () => undefined;

describe('DivergenceBadge', () => {
  it('renders nothing when the base did not advance', () => {
    const { container } = render(<DivergenceBadge count={0} />);
    expect(container.textContent).toBe('');
  });

  it('pluralizes the number of commits', () => {
    const { rerender } = render(<DivergenceBadge count={1} />);
    expect(screen.getByTestId('divergence').textContent).toBe('base avançou 1 commit');
    rerender(<DivergenceBadge count={3} />);
    expect(screen.getByTestId('divergence').textContent).toBe('base avançou 3 commits');
  });

  it('appears in the panel header and in the tree row', () => {
    render(
      <>
        <PanelHeader execution={execution('e1')} agent={agentDef('claude')} onClose={noop} baseAdvancedBy={2} />
        <ul>
          <TreeExecution
            execution={execution('e2')}
            agent={agentDef('claude')}
            open={false}
            baseAdvancedBy={5}
            onOpen={noop}
            onStop={noop}
            onRelaunch={noop}
            onRemove={noop}
          />
        </ul>
      </>,
    );
    expect(within(screen.getByTestId('panel-header')).getByTestId('divergence').textContent).toBe(
      'base avançou 2 commits',
    );
    expect(within(screen.getByTestId('tree-exec-e2')).getByTestId('divergence').textContent).toBe(
      'base avançou 5 commits',
    );
  });
});
