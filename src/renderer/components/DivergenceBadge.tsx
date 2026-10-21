/** Selo "base avançou N commits"; nada quando a base não avançou. */
export function DivergenceBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="divergence-badge"
      data-testid="divergence"
      title="A branch de partida recebeu commits depois que este worktree foi criado."
    >
      base avançou {count} {count === 1 ? 'commit' : 'commits'}
    </span>
  );
}
